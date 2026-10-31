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

A `confirmation` operation never passes on its own, even with a well-formed input:

```console
$ npx ars test docs/schemas/familyos/financeiro.yml deletar_gasto --input '{"gasto_id": 42, "confirmacao":"CONFIRMAR"}'
Testing operation: deletar_gasto (Confirmation — Requires explicit confirmation)
Requires Human Confirmation
  - Operation "deletar_gasto" always requires human confirmation
```

The output above has colors and emoji stripped; the FamilyOS strings are Portuguese because that schema is a real, untranslated system. `ars risk <file>` prints the same schema grouped by level.

## Where ARS sits

ARS is not a replacement for MCP tool annotations or for runtime hooks. It covers a different layer: the policy the *system owner* declares once.

| Capability | MCP tool annotations | Runtime hooks / guardrails | ARS |
|---|---|---|---|
| Read-only vs destructive flag | ✅ `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` | ✅ Can inspect the tool call and decide | ✅ Four risk levels; the MCP adapter emits the annotations from them |
| Human confirmation | ❌ Hint only; the client decides | ✅ Can block or prompt (e.g. Claude Code `PreToolUse`) | 🟡 Declared per operation with a message template; see "How confirmation works today" |
| State guards against the real system ("is the month closed?") | ❌ | 🟡 Possible if you write the check yourself | 🟡 Declared in the schema, resolved via adapters (`adapter-sqlite`, `adapter-rest`); not yet wired into the MCP pipeline |
| Validation rules / foreign-key gate | ❌ Input shape only (JSON Schema) | 🟡 Custom code per hook | ✅ Field rules and FK existence check run before the executor |
| Errors that teach (`reason` + `what_to_do`) | ❌ | ❌ | ✅ Validation failures return structured signposts |
| Signpost / `next` actions | ❌ | ❌ | ✅ Declared per operation, returned with the result |
| Response strategy (summary vs full) | ❌ | ❌ | 🟡 Declared in the schema as a contract for the agent; not enforced by the runtime |
| Audit | ❌ | 🟡 Possible via hook logging | 🟡 `audit` block exists in the schema; this repo does not write an audit log yet |
| Where the policy lives | Client, as a hint | Client, per installation | The system's own contract |
| Who writes it | The tool author | The operator of the agent | The owner of the system |

In short: ARS does not compete with annotations or hooks. The MCP adapter already emits annotations from the risk level (`operationToolAnnotations` in [`packages/adapter-mcp/src/schema.ts`](packages/adapter-mcp/src/schema.ts): FREE gives `readOnlyHint`, CONFIRMATION gives `destructiveHint`; the other levels emit none), and hooks are the natural place to enforce, on the client, the policy ARS declares. The gateway enforces on the server side, where the check does not depend on trusting the client. The MCP SDK itself documents annotations as hints that clients should not make trust decisions from, which is why ARS also runs validation in the pipeline.

## How confirmation works today

In the MCP adapter, a `confirmation` operation **never executes**. The pipeline in [`packages/adapter-mcp/src/pipeline.ts`](packages/adapter-mcp/src/pipeline.ts) (`runOperation`, lines 49-51) returns a `pending` signpost, built from the schema's `message_template`, instead of calling the executor whenever `needsHumanConfirmation` is true (`risk_level: confirmation`, or a field-level `human_confirmation_if` trigger). The tool description says the same up front (`operationToolDescription` in [`schema.ts`](packages/adapter-mcp/src/schema.ts), line 145).

There is no resume step in this repo: nothing takes a "CONFIRMAR" reply and runs the operation. Showing the template to a human and re-issuing the action after approval is the responsibility of the host/client (for example a hook or a UI) or of whatever you build around the engine. The gateway in this repo registers its tools through the same pipeline, so it inherits this behavior. The `Reply CONFIRMAR to proceed` text in the examples is the message a host shows the human, not a protocol the packages complete end to end.

## Packages

| Package | What it does |
|---|---|
| `packages/core` | `@agent-ready/core`: schema loader, input validation, risk assessment, signpost generation |
| `packages/cli` | `@agent-ready/cli`: the `ars` command (`validate`, `list`, `risk`, `test`) |
| `packages/adapter-mcp` | Bridges an ARS schema to MCP tools, running the governance pipeline on each call |
| `packages/adapter-sqlite` | Resolves state-guard predicates against SQLite |
| `packages/adapter-rest` | Resolves predicates via HTTP |
| `packages/gateway` | `@agent-ready/gateway`: generic ARS gateway engine. Loads a declarative plugin directory (ARS schemas plus an HTTP executor mapping) and serves it as MCP tools over Streamable HTTP, with no per-system code. CLI: `ars-gateway --plugin <dir> [--port 8808]` |

`apps/docs` (Astro Starlight site) and `apps/playground` (Svelte schema editor) are early-stage.

## Docs

- [`docs/README.md`](docs/README.md): the idea, the model, the FamilyOS reference implementation, status
- [`docs/spec/agent-ready-schema-v0.1.md`](docs/spec/agent-ready-schema-v0.1.md): the formal v0.1 specification
- [`docs/schemas/familyos/`](docs/schemas/familyos/): the six real FamilyOS schemas

## License

[MIT](LICENSE)
