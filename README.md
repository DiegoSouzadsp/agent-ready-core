# Agent-Ready Schema (ARS)

An open standard for describing, in the system's own contract, what an AI agent may do on its own, what needs validation, and what needs a human.

**Status:** v0.1 draft spec with one reference implementation (FamilyOS, the author's own system). Contributions and a second adopter are the next step.

## Risk levels

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
- `ars hooks export <schema> --target claude-code [--server <name>] [--out <dir>]` writes `ars-pretooluse.mjs` and `settings.snippet.json` (matcher `mcp__<name>__.*`). The hook answers `allow` for free, validated and contextual operations, `ask` for confirmation, and nothing for tools it does not know. `--server` defaults to `agent-ready`, `--out` to `.`. The hook widens autonomy according to `risk_level`: `allow` skips Claude Code's normal permission prompt, and only `confirmation` becomes `ask` (with the `message_template` rendered from the tool input).

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
| Where the policy lives | Client, as a hint | Client, per installation | The system's own contract |
| Who writes it | The tool author | The operator of the agent | The owner of the system |

In short: ARS does not compete with annotations or hooks. The MCP adapter already emits annotations from the risk level (`operationToolAnnotations` in [`packages/adapter-mcp/src/schema.ts`](packages/adapter-mcp/src/schema.ts): FREE gives `readOnlyHint`, CONFIRMATION gives `destructiveHint`; the other levels emit none), and hooks are the natural place to enforce, on the client, the policy ARS declares. The gateway enforces on the server side, where the check does not depend on trusting the client. The MCP SDK itself documents annotations as hints that clients should not make trust decisions from, which is why ARS also runs validation in the pipeline.

## How confirmation works today

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
- Creates a starter schema and a Claude Code hook from a schema ([`packages/cli/src/index.ts`](packages/cli/src/index.ts): `ars init`, `ars hooks export`).

## What it can do

- Export hooks for runtimes other than Claude Code.
- Configure `resolvers` per plugin in the gateway; today only the programmatic option exists.
- Run against a second reference system besides FamilyOS.
- Publish the packages to npm.

## Pains it solves

- The autonomy decision written into each integration's prompt is declared once in the schema.
- A raw protocol error the agent cannot fix becomes a signpost with the fields to correct.
- Confirmation that depends on the model remembering to ask becomes a gate in the pipeline.
- No record of what the agent decided becomes one audit event per call.
- A text-only client that could not see the result receives the data in the text.

## Packages

| Package | What it does |
|---|---|
| `packages/core` | `@agent-ready/core`: schema loader, input validation, risk assessment, signpost generation |
| `packages/cli` | `@agent-ready/cli`: the `ars` command (`validate`, `list`, `risk`, `test`, `init`, `hooks export`) |
| `packages/adapter-mcp` | Bridges an ARS schema to MCP tools, running the governance pipeline on each call (validation, state guards through `resolvers`, elicitation, audit through `onAudit`) |
| `packages/adapter-sqlite` | Resolves state-guard predicates against SQLite |
| `packages/adapter-rest` | Resolves predicates via HTTP |
| `packages/gateway` | `@agent-ready/gateway`: generic ARS gateway engine. Loads a declarative plugin directory (ARS schemas plus an HTTP executor mapping) and serves it as MCP tools over Streamable HTTP, with no per-system code. Takes `resolvers` and `onAudit` as options; audit goes to stderr by default. CLI: `ars-gateway --plugin <dir> [--port 8808]` |

`apps/docs` (Astro Starlight site) and `apps/playground` (Svelte schema editor) are early-stage.

## Docs

- [`docs/README.md`](docs/README.md): the idea, the model, the FamilyOS reference implementation, status
- [`docs/spec/agent-ready-schema-v0.1.md`](docs/spec/agent-ready-schema-v0.1.md): the formal v0.1 specification
- [`docs/schemas/familyos/`](docs/schemas/familyos/): the six real FamilyOS schemas

## License

[MIT](LICENSE)
