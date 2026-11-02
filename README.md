# Agent-Ready Schema (ARS)

An open standard for describing, in the system's own contract, what an AI agent may do on its own, what needs validation, and what needs a human.

**Status:** v0.1 draft spec with one reference implementation (FamilyOS, the author's own system). Contributions and a second adopter are the next step. Packages are at 0.2.0 and not yet on npm; `npm run release:check` is the dry run (clean build plus a publish dry-run of the six tarballs).

![Where ARS sits: Agent, Hook, MCP, ARS runtime and System, with agent-ready.yml feeding the hook and the runtime](docs/assets/where-ars-sits.svg)

*The owner writes agent-ready.yml once; the hook anticipates it on the client and the ARS runtime enforces it on the server.*

## Risk levels

![Risk ladder: FREE, VALIDATED, CONTEXTUAL and CONFIRMATION with policy, runtime behavior, MCP annotation and hook decision](docs/assets/risk-ladder.svg)

*Four levels, each with its runtime behavior, MCP annotation and hook decision; only CONFIRMATION makes the hook ask.*

Every operation declares one level. The system owner writes it once; any agent consumes it.

| Level | Policy | Typical use |
|-------|--------|-------------|
| FREE | Executes immediately | Pure read, no state change |
| VALIDATED | Validates input, then executes | Creates new state |
| CONTEXTUAL | Validates input and checks real system state first | Modifies existing state |
| CONFIRMATION | Requires explicit human confirmation | Irreversible |

## Quickstart (no npm publish needed)

Requires Node 18+. From a clone of this repo:

```bash
npm install
npm run build        # builds every workspace (packages and apps)
```

The workspace links the `ars` bin, so `npx ars` works from the repo root (or call `node packages/cli/dist/index.js` directly).

Validate a schema (real output, FamilyOS finance module):

```console
$ npx ars validate docs/schemas/familyos/financeiro.yml
Validating schema: docs/schemas/familyos/financeiro.yml...
Schema is valid!
Module: financeiro
Operations: 8
```

List its operations and risk levels:

```console
$ npx ars list docs/schemas/familyos/financeiro.yml
ID        | Name                | Risk Level
------------------------------------------------
OP-FIN-01 | registrar_gasto     | Validated — Validate before executing
OP-FIN-04 | consulta_mes        | Free — Execute immediately
OP-FIN-05 | atualizar_gasto     | Contextual — Validate state then execute
OP-FIN-06 | deletar_gasto       | Confirmation — Requires explicit confirmation
OP-FIN-07 | fechar_mes          | Confirmation — Requires explicit confirmation
...                              (8 operations; output shortened)
```

Test an operation locally, without an agent. An incomplete call comes back as a teaching error (`reason` + `what_to_do`):

```console
$ npx ars test docs/schemas/familyos/financeiro.yml registrar_gasto --input '{}'
Testing operation: registrar_gasto (Validated — Validate before executing)
Validation Failed

Signpost Result:
Reason: Não foi possível registrar o gasto.
What to do: Fix the following fields: descricao, valor, categoria_id

Errors:
  - [descricao] (REQUIRED) Field "descricao" is required
  - [valor] (REQUIRED) Field "valor" is required
  - [categoria_id] (REQUIRED) Field "categoria_id" is required
```

A `confirmation` operation never passes validation on its own, even with a well-formed input. It always asks for a human:

```console
$ npx ars test docs/schemas/familyos/financeiro.yml deletar_gasto --input '{"gasto_id": 42, "confirmacao":"CONFIRMAR"}'
Testing operation: deletar_gasto (Confirmation — Requires explicit confirmation)
Requires Human Confirmation
  - Operation "deletar_gasto" always requires human confirmation
```

Start a new project from a template, and export the contract as a Claude Code hook (real output, paths shortened):

```console
$ npx ars init my-service
Created my-service/agent-ready.yml
Next: ars validate my-service/agent-ready.yml

$ npx ars hooks export my-service/agent-ready.yml --target claude-code --server my-app --out .claude/ars
Wrote .claude/ars/ars-pretooluse.mjs
Wrote .claude/ars/settings.snippet.json
Merge settings.snippet.json into .claude/settings.json (format: https://code.claude.com/docs/en/hooks)
```

- `ars init [dir] [--force]` writes `<dir>/agent-ready.yml` with four operations (free, validated, contextual, confirmation) and English comments. It refuses to overwrite an existing file without `--force`.
- `ars init --from-openapi <file.json|.yaml|url> [dir] [--force]` generates a first `agent-ready.yml` from an OpenAPI document. Risk comes from the HTTP method: GET `free`, POST `validated`, PUT/PATCH `contextual`, DELETE `confirmation`. Local `$ref` is resolved, an external `$ref` warns on stderr, the result is validated before it is written, and on failure nothing is written. Review the levels before you rely on them. Real output on the fixture `packages/cli/src/__fixtures__/petstore-mini.yaml` (path shortened, colors stripped):

```console
$ npx ars init --from-openapi packages/cli/src/__fixtures__/petstore-mini.yaml petstore
Created petstore/agent-ready.yml
Next: ars validate petstore/agent-ready.yml
```

  The file holds `module: petstore-mini` with 8 operations, e.g. `listPets` (`free`), `createPet` (`validated`), `updatePet` (`contextual`), `deletePet` (`confirmation`).
- `ars hooks export <schema> --target claude-code [--server <name>] [--out <dir>]` writes `ars-pretooluse.mjs` and `settings.snippet.json` (matcher `mcp__<name>__.*`). The hook answers `allow` for free, validated and contextual operations, `ask` for confirmation, and nothing for tools it does not know. `--server` defaults to `agent-ready`, `--out` to `.`. The hook widens autonomy according to `risk_level`: `allow` skips Claude Code's normal permission prompt, and only `confirmation` becomes `ask` (with the `message_template` rendered from the tool input).

Give the agent its own ceiling (the operator's side, see "Two-sided governance" below). Real output on the quickstart schema, paths shortened:

```console
$ npx ars agent init my-agent
Created my-agent/agent-policy.yml
Next: ars hooks export <schema> --target claude-code --server <name> --agent-policy my-agent/agent-policy.yml

$ npx ars hooks export examples/quickstart/support-tickets.yml --target claude-code --server support-tickets --agent-policy examples/quickstart/agent-policy.yml --out .claude/ars
Wrote .claude/ars/ars-pretooluse.mjs
Wrote .claude/ars/settings.snippet.json
Merge settings.snippet.json into .claude/settings.json (format: https://code.claude.com/docs/en/hooks)

$ echo '{"tool_name":"mcp__support-tickets__delete_ticket","tool_input":{"ticket_id":1}}' | node .claude/ars/ars-pretooluse.mjs
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"agent policy support-bot does not allow delete_ticket (confirmation); it executes up to validated and asks up to contextual"}}
```

With `--agent-policy`, the same script answers `allow` for `create_ticket` and `ask` for `close_ticket`. Without the flag the hook behaves as described above.

`ars agent init [dir] [--force]` writes `<dir>/agent-policy.yml` (validated before it is written) and refuses to overwrite without `--force`.

A runnable server with one operation per risk level is in [`examples/quickstart/`](examples/quickstart/).

The output above has colors and emoji stripped; the FamilyOS strings are Portuguese because that schema is a real, untranslated system. `ars risk <file>` prints the same schema grouped by level.

## Where ARS sits

ARS is not a replacement for MCP tool annotations or for runtime hooks. It covers a different layer: the policy the *system owner* declares once.

| Capability | MCP tool annotations | Runtime hooks / guardrails | ARS |
|---|---|---|---|
| Read-only vs destructive flag | ✅ `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` | ✅ Can inspect the tool call and decide | ✅ Four risk levels; the MCP adapter emits the annotations from them |
| Human confirmation | ❌ Hint only; the client decides | ✅ Can block or prompt (e.g. Claude Code `PreToolUse`) | ✅ `risk_level: confirmation` always asks, through MCP elicitation when the client supports it, otherwise returns `pending`; see "How confirmation works today" |
| State guards against the real system ("is the month closed?") | ❌ | 🟡 Possible if you write the check yourself | ✅ Enforced when `registerArsTools` receives `resolvers`: a failing guard returns `blocked_transition` and the executor is not called. 🟡 With no `guardResolver`/`resolvers` configured, which is the default, guards are declared only: the tool description and a stderr warning say so |
| Validation rules / foreign-key gate | ❌ Input shape only (JSON Schema) | 🟡 Custom code per hook | ✅ Field rules and FK existence check run before the executor |
| Errors that teach (`reason` + `what_to_do`) | ❌ | ❌ | ✅ Validation failures return structured signposts |
| Signpost / `next` actions | ❌ | ❌ | ✅ Declared per operation, returned with the result |
| Response strategy (summary vs full) | ❌ | ❌ | ✅ `mode: summary` with `summary_fields` returns only those fields plus a `next` to `detail_operation`. 🟡 Top-level fields only; `paginated` and `full` are declared, not enforced |
| Audit | ❌ | 🟡 Possible via hook logging | ✅ One `AuditEvent` per call to the `onAudit` sink, or JSON lines on stderr with `ARS_AUDIT=stderr` (the gateway writes to stderr by default). 🟡 The schema's `audit.log` flag is not read; only `include_fields` is used |
| Per-agent / per-identity policy | ❌ | 🟡 Possible if you write it per installation | ✅ `agent-policy.yml` sets how far a given agent may go; the hook export and the gateway (one profile per token) enforce it |
| Where the policy lives | Client, as a hint | Client, per installation | The system's own contract |
| Proof on the system side | ❌ | ❌ | ✅ The gateway signs each call it forwards (`X-ARS-Signature`), and the system verifies it with `verifyArsSignature`, so it can refuse calls that skipped the governance |
| Who writes it | The tool author | The operator of the agent | The owner of the system |

In short: ARS does not compete with annotations or hooks. The MCP adapter already emits annotations from the risk level (`operationToolAnnotations` in [`packages/adapter-mcp/src/schema.ts`](packages/adapter-mcp/src/schema.ts): FREE gives `readOnlyHint`, CONFIRMATION gives `destructiveHint`; the other levels emit none), and hooks are the natural place to enforce, on the client, the policy ARS declares. The gateway enforces on the server side, where the check does not depend on trusting the client. The MCP SDK itself documents annotations as hints that clients should not make trust decisions from, which is why ARS also runs validation in the pipeline.

### Other approaches to agent governance

Sources were read on 2026-11-02; check them for the current state.

| Approach | Where the policy lives | Who writes it | What it decides | Relation to ARS |
|---|---|---|---|---|
| [Microsoft Agent Governance Toolkit](https://github.com/microsoft/agent-governance-toolkit) (AGT) | YAML policy files (it also accepts OPA/Rego and Cedar) loaded by the host application; an MCP gateway sits between client and tool servers | The sources do not say | Allow, `deny` or `require_approval` per tool call, with a default action; trust scores, privilege rings, tool-definition scanning | Overlaps on per-call enforcement and audit. AGT governs the agent from the operator's side, for everything it touches; ARS governs the agent from the system's side, operation by operation, through the system's own contract |
| [Open Policy Agent](https://github.com/open-policy-agent/opa) (OPA) | Rego policies evaluated by an OPA engine that a service queries | Whoever defines the rules; the page names no role | Allow or deny from the input and data you supply | General-purpose engine; ARS could sit on top of one, it does not replace it |
| [Cedar](https://github.com/cedar-policy/cedar) | Cedar policies kept separate from application code | The page names no role | Permit or deny for a principal, action and resource; default deny | Authorization language; no notion of risk level or confirmation, and no MCP integration in its README |
| [Agent Control Standard](https://github.com/GenAI-Security-Project/agent-control-standard) (ACS) | A separate Guardian Agent evaluating a written policy with an engine such as OPA/Rego or Cedar | The page does not say | Allow, deny, modify, ask (route to an approver) or defer, at lifecycle hooks of the observed agent | Wire spec for a guardian outside the agent; ARS is a schema plus a runtime inside the system |
| [MCP roadmap 2026](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) | Not applicable; it is a plan for the protocol | MCP maintainers and working groups | Names audit trails, SSO-integrated auth, gateway behavior and configuration portability as enterprise-readiness work, not yet defined | ARS targets the same gaps from the system side; nothing in the roadmap covers risk levels or confirmation |

**Microsoft AGT.** AGT covers more of the agent side than ARS does: its MCP gateway scans tool definitions for hidden instructions and typosquatting, it ships a prompt-injection evaluator, a four-ring execution sandbox, trust scores, a hash-chained audit log and adapters for a long list of agent frameworks ([README](https://github.com/microsoft/agent-governance-toolkit), [Microsoft blog](https://developer.microsoft.com/blog/securing-mcp-a-control-plane-for-agent-tool-execution/)). The sources do not say who writes its policy; it is loaded by the host application. ARS adds a declaration written by the owner of the system, preconditions checked against real system state, teaching errors, and a signature the system itself can verify. The two can be combined; AGT is MIT and in public preview according to its own post.

**Open Policy Agent.** OPA is a CNCF graduated, general-purpose policy engine with a mature language, tooling and ecosystem ([repository](https://github.com/open-policy-agent/opa)); ARS has no policy language and no engine of that kind. OPA returns a decision and leaves everything else to the service: no risk ladder, no human gate, no message for the agent. ARS is narrower and ready-made for tool calls, and the README does not mention MCP support in OPA itself.

**Cedar.** Cedar is a policy language with a schema validator and formal analysis tooling, designed so policies can be authored, analyzed and audited apart from application code ([repository](https://github.com/cedar-policy/cedar)). It answers whether a principal may perform an action on a resource, which ARS does not model; ARS answers how much autonomy an operation gets and what happens when the state is wrong. The Cedar README does not mention MCP or agents.

**Agent Control Standard.** ACS, an OWASP GenAI Security Project, specifies a wire contract (JSON-RPC 2.0) between an agent and a Guardian that can allow, deny, modify, ask or defer at nineteen lifecycle hooks, with OpenTelemetry and OCSF audit and optional signing; it is at v0.1, and its README states that the reference Guardian does not yet implement the signing it requires and evaluates two hooks live ([repository](https://github.com/GenAI-Security-Project/agent-control-standard)). It covers hooks across agent frameworks, where ARS covers one MCP boundary. ARS does not implement ACS.

**MCP roadmap.** The roadmap lists enterprise readiness (audit trails, SSO-integrated auth, gateway behavior, configuration portability) as an area with no working group yet, and mentions SEP-1932 (DPoP) and SEP-1933 (workload identity) for authorization; risk annotations and confirmation are not in it ([roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)). Separately, the MCP blog treats tool annotations as hints that clients must not trust from an untrusted server, and lists open SEPs for more annotations, such as #1913 (trust and sensitivity) and #1984 ([post](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)). If those land, the annotations ARS emits could map onto them.

**What ARS does not do (yet).** Compared with the projects above, ARS has per-agent policy (one ceiling per token profile) but no per-tenant policy, no roles, no rate limits, and no asynchronous approval: confirmation is an elicitation or a `pending` result. It does not scan tool definitions or responses for injection, does not sandbox execution, does not filter output for personal data, does not coordinate several agents, and does not export OpenTelemetry; audit is an event sink or JSON lines on stderr. It has no policy language with unit tests or formal analysis, no revocation of a signed call beyond the nonce and skew window, and no versioned policy distribution. Some of these may fit ARS and some belong in the tools above; none has a date.

## Two-sided governance

The schema is the system's side: the owner declares the risk of each operation. The second side is the operator's: an `agent-policy.yml`, in the same four levels, declares how far *one agent* may go on its own. Neither file knows the other; the enforcement points cross them, and neither is rewritten when the pair changes. The "where ARS sits" figure above shows the system's side; the operator's side enters through the hook and through the gateway's agent profile.

```yaml
agent_policy: "1.0"
name: support-bot            # agent identity (letters, digits, _ . -)
autonomy:
  execute_up_to: validated   # free|validated|contextual: runs on its own up to this level
  ask_up_to: contextual      # above execute_up_to and up to this level: asks a human
  # above ask_up_to: denied. confirmation can never be execute_up_to.
systems:                     # optional per-system exceptions (MCP server name / plugin name)
  support-tickets:
    execute_up_to: contextual
    operations:
      delete_ticket: deny    # allow|ask|deny per operation; wins over every ceiling
```

This is the file `ars agent init` writes. For one operation, the decision is the first rule that matches:

1. an entry in `systems.<system>.operations` for that operation;
2. the risk is at or below `execute_up_to` (the system's own value if set, else `autonomy`): `allow`;
3. the risk is at or below `ask_up_to`: `ask`;
4. otherwise `deny`.

With no policy nothing changes: execute up to `contextual`, ask at `confirmation`.

- **Hook.** `ars hooks export <schema> --target claude-code --server <name> --agent-policy <file>` resolves the policy per operation and embeds the result in the generated script: `allow`, `ask` or `deny` (the deny reason names the policy and its ceilings). `system` is the value of `--server`. The hook cannot see field-level confirmation triggers (`human_confirmation_if`), because it does not evaluate the tool input against the schema; the gateway can.
- **Gateway.** `ars-gateway --plugin <dir> --token <t>=<profile> --agent-policy <file|dir>` (both repeatable), or `ARS_GATEWAY_TOKENS=a=bot1,b`, or `policies/*.yml` in the plugin directory. The profile is a policy's `name`, chosen by the Bearer token of each request. `system` is the plugin name. Before validation, `deny` returns a `denied` signpost and an audit event with `decision: 'denied'`, and the system is never called; `ask` goes through elicitation or returns `pending`. The profile reaches the system in `X-ARS-Agent`, inside the signed string. Details in [`packages/gateway`](packages/gateway/README.md).
- **Invariant: `allow` never lowers what the system requires.** A `confirmation` operation still needs a human when the policy says `allow` (the decision becomes `ask`), and the schema's own triggers still fire. An agent policy can add a check or a refusal; it cannot remove one.

Example for the quickstart server: [`examples/quickstart/agent-policy.yml`](examples/quickstart/agent-policy.yml). The format is specified in [the spec](docs/spec/agent-ready-schema-v0.1.md).

## Closing the door: gateway auth and proof of governance

Two things make the gateway usable as the only way in. Both are in [`packages/gateway`](packages/gateway/README.md).

- **Inbound auth.** Configure `inboundTokens`, `ars-gateway --token <t>` (repeatable) or `ARS_GATEWAY_TOKENS=a,b`. A request to `/mcp` without a valid Bearer token gets 401 before any session exists; `/healthz` stays public and returns only `{"status":"ok"}`. The default host is `127.0.0.1`. With no tokens the gateway prints a warning on stderr, trusts `X-Acting-User`, and refuses to listen beyond loopback unless you pass `--insecure-no-auth` (`allowInsecureNoAuth: true`). A `--token` with no value is an error. A token can carry an agent profile, `--token <t>=<profile>` (or `ARS_GATEWAY_TOKENS=a=bot1,b`); see "Two-sided governance".
- **Proof of governance.** With `auth.signing_secret` in `plugin.yml` (`${ENV}` is accepted; a declared secret that resolves to empty fails at load), every request the gateway sends to the system carries `X-ARS-Timestamp`, `X-ARS-Nonce`, `X-ARS-Operation`, `X-ARS-Risk`, `X-ARS-Decision` (`executed` or `confirmed`), `X-ARS-Agent` (the token's profile, empty when it has none) and `X-ARS-Signature` (`v1=<hex>`, HMAC-SHA256 over `timestamp \n nonce \n METHOD \n path+query \n sha256(body) \n operation \n risk \n decision \n acting_user \n agent`). The system verifies it with `verifyArsSignature`:

```ts
import { verifyArsSignature } from '@agent-ready/gateway';

app.use(express.text({ type: '*/*' })); // raw body; a GET leaves req.body as {} and verifies as empty
app.use((req, res, next) => {
  const v = verifyArsSignature({ method: req.method, url: req.originalUrl, body: req.body, headers: req.headers }, process.env.ARS_SIGNING_SECRET!);
  if (!v.ok) return res.status(401).json({ error: v.reason });
  next(); // v.operation, v.risk, v.decision, v.nonce, v.actingUser, v.agent are available; require v.decision === 'confirmed' on destructive routes
});
```

The system then accepts only calls that went through the governance: anything without a valid signature, including a direct call that skips the gateway, is rejected by the system itself. The default skew is 120 s.

**Replay.** A valid signature stays valid for the whole skew window, so the system must remember the nonces it has seen inside it and serve over TLS:

```ts
const seen = new Map<string, number>();
const fresh = (nonce: string) => { const now = Date.now(); for (const [n, t] of seen) if (now - t > 240_000) seen.delete(n); return !seen.has(nonce) && !!seen.set(nonce, now); };
// after verifyArsSignature: if (!fresh(v.nonce)) return res.status(401).json({ error: 'replay' });
```

The gateway does not store or rotate the secret. Executors written in code receive `{ decision, risk_level }` as an optional second argument (`ExecutorContext`).

## How confirmation works today

![Lifecycle of a tools/call: validation, state guards, human gate, executor, signpost, with an audit event on every call](docs/assets/call-lifecycle.svg)

*One tools/call through the pipeline, with its signposts and the audit event emitted on every path.*

In the MCP adapter, an operation needs a human when `risk_level` is `confirmation`, or when `autonomy_policy`, `human_confirmation.required` or a field-level `human_confirmation_if` trigger says so. The gate lives in [`packages/adapter-mcp/src/pipeline.ts`](packages/adapter-mcp/src/pipeline.ts) (`decide`, which calls `askHuman`), after validation and state guards and before the executor.

- **Client supports MCP elicitation:** `askHuman` calls `elicitInput` with the rendered `message_template` and a required boolean `confirm`. Only `accept` with `confirm: true` runs the executor. `decline`, `cancel` or `confirm: false` return a `pending` signpost saying the human declined, and the executor is not called.
- **Client does not advertise elicitation, or the request fails or times out:** the call returns the `pending` signpost, built from the schema's `message_template`, and the executor is not called. Showing the template to a human and re-issuing the action is then up to the host (for example a hook or a UI).

There is no text-based resume: a "CONFIRMAR" reply is not a protocol and the packages do not act on it. The gateway registers its tools through the same pipeline and inherits both paths. `pending_status` in `human_confirmation` is not read by the runtime. Tests: [`packages/adapter-mcp/src/pipeline.test.ts`](packages/adapter-mcp/src/pipeline.test.ts).

## What it does

- Validates input before the executor and returns `reason` + `what_to_do` on failure; every tool field is optional in the MCP schema, so the agent sees the signpost instead of a protocol error ([`pipeline.ts`](packages/adapter-mcp/src/pipeline.ts), [`schema.ts`](packages/adapter-mcp/src/schema.ts)).
- Blocks an operation when a `state_guard` fails, if the host passes `resolvers` to `registerArsTools` ([`pipeline.ts`](packages/adapter-mcp/src/pipeline.ts) `evaluateGuards`).
- Asks a human for `confirmation` operations through MCP elicitation, or returns `pending` ([`pipeline.ts`](packages/adapter-mcp/src/pipeline.ts) `askHuman`).
- Puts the result data in the tool's text and trims it to `summary_fields` when the response strategy asks ([`pipeline.ts`](packages/adapter-mcp/src/pipeline.ts) `successResult`, `applyResponseStrategy`).
- Emits one audit event per call to `onAudit` or stderr ([`pipeline.ts`](packages/adapter-mcp/src/pipeline.ts) `emitAudit`).
- Applies a per-agent ceiling from `agent-policy.yml`: the exported hook answers `allow`, `ask` or `deny` per operation, and the gateway resolves it per token before validation, returning a `denied` signpost without calling the system ([`packages/core/src/agent-policy.ts`](packages/core/src/agent-policy.ts) `resolveAutonomy`).
- Signs the agent profile into `X-ARS-Agent`, so the system sees which agent profile made each call.
- Creates a starter schema and a Claude Code hook from a schema ([`packages/cli/src/index.ts`](packages/cli/src/index.ts): `ars init`, `ars hooks export`).

## What it can do next

- Export hooks for runtimes other than Claude Code.
- Configure `resolvers` per plugin in the gateway; today only the programmatic option exists.
- Run against a second reference system besides FamilyOS.
- Publish the packages to npm (versions are 0.2.0 and ready; `npm run release:check` is the dry run).
- OAuth 2.1 for the gateway; inbound auth is a static Bearer list today.
- Session expiry in the gateway.

## Pains it solves

![Without ARS versus with ARS for the request delete ticket 1](docs/assets/with-vs-without.svg)

*The same request, delete ticket 1: safety by luck versus safety by structure.*

- The autonomy decision written into each integration's prompt is declared once in the schema.
- A raw protocol error the agent cannot fix becomes a signpost with the fields to correct.
- Confirmation that depends on the model remembering to ask becomes a gate in the pipeline.
- No record of what the agent decided becomes one audit event per call.
- A text-only client that could not see the result receives the data in the text.

## Packages

| Package | What it does |
|---|---|
| `packages/core` | `@agent-ready/core`: schema loader, input validation, risk assessment, signpost generation |
| `packages/cli` | `@agent-ready/cli`: the `ars` command (`validate`, `list`, `risk`, `test`, `init`, `hooks export`, `agent init`) |
| `packages/adapter-mcp` | Bridges an ARS schema to MCP tools, running the governance pipeline on each call (validation, state guards through `resolvers`, elicitation, audit through `onAudit`) |
| `packages/adapter-sqlite` | Resolves state-guard predicates against SQLite |
| `packages/adapter-rest` | Resolves predicates via HTTP |
| `packages/gateway` | `@agent-ready/gateway`: generic ARS gateway engine. Loads a declarative plugin directory (ARS schemas plus an HTTP executor mapping) and serves it as MCP tools over Streamable HTTP, with no per-system code. Takes `resolvers` and `onAudit` as options; audit goes to stderr by default. CLI: `ars-gateway --plugin <dir> [--port 8808] [--token <t>]...`. Inbound Bearer tokens (`--token`, `ARS_GATEWAY_TOKENS`, `inboundTokens`) and request signing for the target system (`signing_secret` in `plugin.yml`, verified with `verifyArsSignature`) |

`apps/docs` (Astro Starlight site) and `apps/playground` (Svelte schema editor) are early-stage.

## Docs

- [`docs/README.md`](docs/README.md): the idea, the model, the FamilyOS reference implementation, status
- [`docs/spec/agent-ready-schema-v0.1.md`](docs/spec/agent-ready-schema-v0.1.md): the formal v0.1 specification
- [`docs/schemas/familyos/`](docs/schemas/familyos/): the six real FamilyOS schemas

## License

[MIT](LICENSE)
