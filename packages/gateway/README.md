# @agent-ready/gateway

Serves any system's ARS operations as MCP tools from a plugin directory (`plugin.yml`, `executors.yml`, ARS schemas). No code per system.

```bash
ars-gateway --plugin ./plugins/my-system --port 8808 --token "$GATEWAY_TOKEN"
```

## What the gateway enforces

Every `tools/call` runs the ARS pipeline before the system is touched: input validation, state guards, human confirmation (MCP elicitation) for `confirmation` operations, and an audit event. A client that skips the pipeline cannot reach the system through the gateway. The gateway does not stop someone who holds the system's `service_token` and calls the system directly; that is what the signature below is for.

## Inbound auth (host to gateway)

Pass `inboundTokens` to `startGatewayHttp`, or `--token <t>` (repeatable) / `ARS_GATEWAY_TOKENS=a,b` to `ars-gateway`. A `--token` without a value is an error, never auth silently off. With tokens configured, `/mcp` answers `401 {"error":"unauthorized"}` unless the request carries `Authorization: Bearer <token>`, before any session is created and before `X-Acting-User` is read. `GET /healthz` is public and returns only `{"status":"ok"}`.

The default host is `127.0.0.1`. Without tokens the gateway prints `inbound auth disabled; X-Acting-User is trusted` to stderr and refuses to listen beyond loopback, unless you pass `--insecure-no-auth` (`allowInsecureNoAuth: true`).

## Proof of governance (gateway to system)

Set `auth.signing_secret` in `plugin.yml` (`${ENV}` is substituted; a declared secret that resolves to empty fails at load) and every request to your system carries:

| Header | Value |
| --- | --- |
| `X-ARS-Timestamp` | epoch milliseconds |
| `X-ARS-Nonce` | 16 random bytes, hex |
| `X-ARS-Operation` | ARS operation name |
| `X-ARS-Risk` | `free`, `validated`, `contextual` or `confirmation` |
| `X-ARS-Decision` | `executed`, or `confirmed` after a human accepted the elicitation |
| `X-ARS-Signature` | `v1=` + HMAC-SHA256 hex |

The signed string is `timestamp \n nonce \n METHOD \n path+query \n sha256hex(body) \n operation \n risk \n decision \n acting_user`, keyed by the secret; `acting_user` is the value of the acting-user header that was sent, or empty. Verify it in your system with the raw body string:

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

`verifyArsSignature(req, secret, { maxSkewMs = 120000, actingUserHeader = 'x-acting-user' })` returns `{ ok: true, operation, risk, decision, nonce, actingUser }` or `{ ok: false, reason }` with `reason` one of `missing_header`, `bad_format`, `expired`, `bad_signature`. Use `decision` to require `confirmed` on destructive routes.

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
