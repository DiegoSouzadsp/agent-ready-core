# @agent-ready/gateway

Serves any system's ARS operations as MCP tools from a plugin directory (`plugin.yml`, `executors.yml`, ARS schemas). No code per system.

```bash
ars-gateway --plugin ./plugins/my-system --port 8808 --token "$GATEWAY_TOKEN"
```

## What the gateway enforces

Every `tools/call` runs the ARS pipeline before the system is touched: input validation, state guards, human confirmation (MCP elicitation) for `confirmation` operations, and an audit event. A client that skips the pipeline cannot reach the system through the gateway. The gateway does not stop someone who holds the system's `service_token` and calls the system directly; that is what the signature below is for.

## Inbound auth (host to gateway)

Pass `inboundTokens` to `startGatewayHttp`, or `--token <t>[@<profile>]` (repeatable) / `ARS_GATEWAY_TOKENS=a,b` to `ars-gateway`. A `--token` without a value is an error, never auth silently off. With tokens configured, `/mcp` answers `401 {"error":"unauthorized"}` unless the request carries `Authorization: Bearer <token>`, before any session is created and before `X-Acting-User` is read. `GET /healthz` is public and returns only `{"status":"ok"}`.

The default host is `127.0.0.1`. Without tokens the gateway prints `inbound auth disabled; X-Acting-User is trusted` to stderr and refuses to listen beyond loopback, unless you pass `--insecure-no-auth` (`allowInsecureNoAuth: true`).

## Agent profiles (operator side)

Give each token an agent profile: `--token <t>@<profile>` (repeatable) or `ARS_GATEWAY_TOKENS=a@bot1,b`. The split is at the last `@`; the suffix must match `[A-Za-z0-9_.-]+` or the gateway fails to start (a bad suffix such as `tok@bot!` is never taken as part of the token). `=` is not special, so base64 padding stays in the token. A token without a profile keeps today's behaviour. Each profile is the `name` of an `agent-policy.yml` (see `ars agent init`), loaded from `--agent-policy <file|dir>` (repeatable) or from `policies/*.yml` in the plugin directory. The gateway refuses to start when a token names a profile with no policy, two policies share a name, a policy is invalid, or one token gets two profiles.

The profile is read from the Bearer of each request, never from the session. Before validation, the policy's `execute_up_to` / `ask_up_to` ceiling (with `systems.<plugin name>` overrides) is resolved against the operation's risk (the `systems` key must equal the plugin name; the gateway warns on startup when no key of a policy matches): `allow` proceeds, `ask` goes through elicitation or returns `pending`, `deny` returns a `denied` signpost, writes an audit event with `decision: 'denied'` and never reaches your system. A profile can only add a human check; `confirmation` always requires one. The tool list is identical for every profile.

## Proof of governance (gateway to system)

Set `auth.signing_secret` in `plugin.yml` (`${ENV}` is substituted; a declared secret that resolves to empty fails at load) and every request to your system carries:

| Header | Value |
| --- | --- |
| `X-ARS-Timestamp` | epoch milliseconds |
| `X-ARS-Nonce` | 16 random bytes, hex |
| `X-ARS-Operation` | ARS operation name |
| `X-ARS-Risk` | `free`, `validated`, `contextual` or `confirmation` |
| `X-ARS-Decision` | `executed`, or `confirmed` after a human accepted the elicitation |
| `X-ARS-Agent` | agent profile of the token, empty when it has none; always sent and signed |
| `X-ARS-Signature` | `v1=` + HMAC-SHA256 hex |

The signed string (v1 finalized before the first npm publish; strings from earlier commits differ) is `timestamp \n nonce \n METHOD \n path+query \n sha256hex(body) \n operation \n risk \n decision \n acting_user`, keyed by the secret; `acting_user` is the value of the acting-user header that was sent, or empty. Verify it in your system with the raw body string:

```ts
import express from 'express';
import { verifyArsSignature } from '@agent-ready/gateway';

const app = express();
app.use(express.text({ type: '*/*' })); // raw body; GET leaves req.body as {} and verifies as empty
app.use((req, res, next) => {
  const v = verifyArsSignature({ method: req.method, url: req.originalUrl, body: req.body, headers: req.headers }, process.env.ARS_SIGNING_SECRET!);
  if (!v.ok) return res.status(401).json({ error: v.reason });
  next();
});
```

`verifyArsSignature(req, secret, { maxSkewMs = 120000, actingUserHeader = 'x-acting-user' })` returns `{ ok: true, operation, risk, decision, nonce, actingUser, agent }` or `{ ok: false, reason }` with `reason` one of `missing_header`, `bad_format`, `expired`, `bad_signature`. Use `decision` to require `confirmed` on destructive routes.

### Replay

A valid signature stays valid for the whole skew window, so the system must remember nonces it has seen and serve over TLS:

```ts
const seen = new Map<string, number>();
const fresh = (nonce: string) => { const now = Date.now(); for (const [n, t] of seen) if (now - t > 240_000) seen.delete(n); return !seen.has(nonce) && !!seen.set(nonce, now); };
// after verifyArsSignature: if (!fresh(v.nonce)) return res.status(401).json({ error: 'replay' });
```

Keep nonces longer than twice `maxSkewMs`. With several instances, use a shared store.

## Limits

- OAuth 2.1 for MCP is out of scope; inbound auth is a static Bearer list.
- Sessions have no expiry yet.
- The gateway does not rotate or store the signing secret; you manage it.
