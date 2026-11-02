# @agent-ready/gateway

Serves any system's ARS operations as MCP tools from a plugin directory (`plugin.yml`, `executors.yml`, ARS schemas). No code per system.

```bash
ars-gateway --plugin ./plugins/my-system --port 8808 --token "$GATEWAY_TOKEN"
```

## What the gateway enforces

Every `tools/call` runs the ARS pipeline before the system is touched: input validation, state guards, human confirmation (MCP elicitation) for `confirmation` operations, and an audit event. A client that skips the pipeline cannot reach the system through the gateway. The gateway does not stop someone who holds the system's `service_token` and calls the system directly; that is what the signature below is for.

## Inbound auth (host to gateway)

Pass `inboundTokens` to `startGatewayHttp`, or `--token <t>` (repeatable) / `ARS_GATEWAY_TOKENS=a,b` to `ars-gateway`. With tokens configured, `/mcp` answers `401 {"error":"unauthorized"}` unless the request carries `Authorization: Bearer <token>`. The check runs before any session is created and before `X-Acting-User` is read. `GET /healthz` stays public for orchestrator probes.

Without tokens the gateway starts, prints `inbound auth disabled; X-Acting-User is trusted` to stderr, and trusts whatever acting user the caller sends. Do not expose it on a shared network in that mode.

## Proof of governance (gateway to system)

Set `auth.signing_secret` in `plugin.yml` (`${ENV}` is substituted) and every request to your system carries:

| Header | Value |
| --- | --- |
| `X-ARS-Timestamp` | epoch milliseconds |
| `X-ARS-Operation` | ARS operation name |
| `X-ARS-Risk` | `free`, `validated`, `contextual` or `confirmation` |
| `X-ARS-Decision` | `executed`, or `confirmed` after a human accepted the elicitation |
| `X-ARS-Signature` | `v1=` + HMAC-SHA256 hex |

The signed string is `timestamp \n METHOD \n path+query \n sha256hex(body) \n operation \n decision`, keyed by the secret. `X-ARS-Risk` is informational and not signed. Verify it in your system with the raw body string:

```ts
import express from 'express';
import { verifyArsSignature } from '@agent-ready/gateway';

const app = express();
app.use(express.text({ type: '*/*' }));
app.use((req, res, next) => {
  const v = verifyArsSignature({ method: req.method, url: req.originalUrl, body: req.body, headers: req.headers }, process.env.ARS_SIGNING_SECRET!);
  if (!v.ok) return res.status(401).json({ error: v.reason });
  next();
});
```

`verifyArsSignature(req, secret, { maxSkewMs = 300000 })` returns `{ ok: true, operation, risk, decision }` or `{ ok: false, reason }` with `reason` one of `missing_header`, `bad_format`, `expired`, `bad_signature`. Use `decision` to require `confirmed` on destructive routes.

## Limits

- OAuth 2.1 for MCP is out of scope; inbound auth is a static Bearer list.
- Sessions have no expiry yet.
- The gateway does not rotate or store the signing secret; you manage it.
- A signature proves the call passed this gateway at that moment; it does not make a replay within the skew window impossible, so make destructive handlers idempotent.
