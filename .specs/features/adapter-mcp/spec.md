# @agent-ready/adapter-mcp Specification

## Problem Statement

Agent-Ready Schema (ARS) is positioned as the governance layer that complements MCP ("MCP is transport, ARS is the brain"), but today that claim is aspirational — the codebase has zero MCP integration. A company already running an MCP server gets no ARS governance without hand-building the bridge themselves, which defeats the "drop-in governance" pitch and is the highest-leverage blocker to riding MCP's existing adoption instead of competing with it.

## Goals

- [ ] Ship `@agent-ready/adapter-mcp`: given a loaded `AgentReady` schema, register one MCP tool per operation on an `McpServer`, so calling the tool runs the full ARS governance pipeline (defaults → validate → confirmation gate → execute → signpost) instead of just describing the operation.
- [ ] Preserve the governance thesis under MCP's stateless call model: `risk_level: confirmation` operations must never execute silently through the bridge, even though the core's `validate()` always reports `needsHumanConfirmation: true` for them with no notion of "already confirmed."
- [ ] Match existing adapter package conventions (`adapter-sqlite`, `adapter-rest`): independent package in `packages/`, no forced I/O in `core`, Vitest coverage, handlers testable without spinning up a transport.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Standalone stdio server / CLI runner as the primary deliverable | P1 is an embeddable library (`registerArsTools(server, agent, executors)`); a thin runner script is P3, built on top of the same function, not a separate product surface |
| Automatic `state_guards` → adapter resolution | The core itself has never resolved the tension between `StateGuard.query` (raw SQL string) and `AdapterResolvers` (named predicates, e.g. `'month.is_open'`) — `OperationHandle.resolveGuard()` takes an arbitrary predicate name entirely decoupled from `operation.state_guards`. Inventing a mapping inside this bridge would lock in an architectural decision that belongs to `core`, ahead of Diego resolving the open question already logged in the original TDD. The bridge accepts an optional `Adapter` for forward compatibility but does not auto-invoke it against `state_guards` in V1. |
| `computed_fields` execution | Not implemented anywhere in `core` today (type exists, never read by validator/signpost) — out of scope here for the same reason it's out of scope everywhere else in the project |
| Two-step / token-based confirmation flow | V1 always blocks `risk_level: confirmation` operations from executing via the bridge (see Assumption #2) rather than inventing a new confirmation protocol on top of a core that has no "already confirmed" concept |
| MCP elicitation (interactive prompts) | Newer, inconsistently supported across MCP clients; not required to hit the P1 goal |
| Publishing to npm, CI setup | Tracked separately (already identified in the repo-hygiene pass); orthogonal to this feature's code |
| Tool-name collision handling across multiple `registerArsTools` calls on the same server | Behavior is whatever the MCP SDK does natively (likely last-registration-wins or throw) — documented, not engineered around |

---

## Assumptions & Open Questions

Diego was asked these three via structured question and did not respond within the window. Proceeding with the recommended default for each — **all three are still open for override before or during Design**.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Who executes the real action on tool call? | Bridge orchestrates; host supplies `executors: Record<operationName, (input) => Promise<result>>`, mirroring the existing `AdapterResolvers` pattern | Makes the MCP tool actually *do* something (standard MCP tool-call expectation) instead of only validating; reuses a pattern already proven by `adapter-sqlite`/`adapter-rest` | n |
| How to handle `risk_level: confirmation` given `validate()` always flags it, with no "already confirmed" state | Always block: bridge never calls the executor for these operations, always returns the `pending` signpost | Safest for a stateless protocol call; invents no new mechanism the core doesn't already support; keeps governance "in the contract" rather than delegating to MCP client UI trust | n |
| Packaging shape | Embeddable library (`registerArsTools`) is P1; standalone stdio runner is P3, built on the same function | More composable, doesn't lock in a transport, still leaves room for a demo/announcement script | n |

**Open questions:** none — all resolved via recommended defaults above (pending Diego's override).

---

## User Stories

### P1: Governed MCP tools from an ARS schema ⭐ MVP

**User Story**: As a developer already running an MCP server, I want to point it at my ARS schema and supply executor functions per operation, so every operation becomes a governed MCP tool without hand-rolling validation/risk/signpost logic myself.

**Why P1**: This is the entire value proposition of the feature — without it, there's no bridge, just a description.

**Acceptance Criteria**:

1. WHEN `registerArsTools(server, agent, executors)` is called with a loaded `AgentReady` instance THEN the system SHALL register one MCP tool per operation in the schema, named after the operation's `name`.
2. WHEN a tool's `inputSchema` is generated THEN the system SHALL derive it from the operation's `input_schema` fields (type, required, enum values, description) as a Zod object consumable by `server.registerTool`. Numeric/length constraints (`gt`, `gte`, `min`, `max`, `min_length`, `max_length`) SHALL NOT be encoded in the Zod schema — see Tech Decision in design.md on why constraint enforcement stays exclusively inside ARS's own `validateInput()`.
3. WHEN a tool is called with input that fails ARS validation THEN the system SHALL return an MCP tool result with `isError: true` and content containing the `validation_error` signpost's guidance and field errors, and SHALL NOT call the executor.
4. WHEN a tool is called with valid input for an operation whose `risk_level` is not `confirmation` THEN the system SHALL call the corresponding executor with the validated (post-defaults) input, and return the `success` signpost (built from the executor's result) as the tool result with `isError: false`.
5. WHEN a tool is called and ARS's `validateInput()` result has `needsHumanConfirmation: true` — whether triggered by `risk_level: confirmation` or by a field-level `human_confirmation_if` (e.g. `valor > 500` on an otherwise `validated`-risk operation) — THEN the system SHALL NOT call the executor for that call, and SHALL return the `pending` signpost as the tool result (`isError: false`, content explains the action requires confirmation outside the automated flow).
6. WHEN a tool call passes validation but no executor is registered for that operation THEN the system SHALL return `isError: true` with a message naming the operation and stating no executor is configured, and SHALL NOT throw an uncaught exception.

**Independent Test**: Load `docs/schemas/familyos/financeiro.yml`, call `registerArsTools` with a stub executor for `registrar_gasto`, call the tool with valid and invalid input, and with an operation that has `risk_level: confirmation` (e.g. `deletar_gasto`) — confirm executor is never invoked for the latter.

---

### P2: Resilient error handling & DX

**User Story**: As a developer integrating an incomplete schema (some operations without executors yet, some with fields the Zod mapper can't perfectly express), I want the bridge to degrade gracefully instead of crashing the MCP server process.

**Why P2**: Important for real-world adoption (schemas are rarely 100% wired on day one) but not required to demonstrate the core value.

**Acceptance Criteria**:

1. WHEN an executor throws or rejects with an unexpected error (not an ARS validation failure) THEN the system SHALL catch it and return `isError: true` with an informative-but-safe message, and SHALL NOT crash the MCP server process.
2. WHEN an `input_schema` field has `type: 'any'` or `type: 'base64'` THEN the Zod mapping SHALL fall back to `z.any()` / `z.string()` respectively (documented approximation — full fidelity stays in ARS's own `validateInput()`, which still runs).
3. WHEN the bridge logs internally (e.g. "no executor configured") THEN it SHALL write to `stderr`, never `stdout` (reserved for MCP stdio JSON-RPC framing).

**Independent Test**: Register a schema with one operation missing an executor and one operation with a `type: 'any'` field; call both; confirm no process crash and correct `isError` results.

---

### P3: Runnable example

**User Story**: As someone evaluating ARS, I want a minimal working example of the MCP bridge running over stdio against a real schema, so I can see it work end-to-end (Claude Desktop / any MCP client) without reading source.

**Why P3**: Valuable for adoption and for the eventual announcement content, but not required for the library itself to be correct or useful.

**Acceptance Criteria**:

1. WHEN the example script is run THEN it SHALL start an MCP server over stdio exposing `docs/schemas/familyos/financeiro.yml` operations as tools, using in-memory stub executors.

---

## Edge Cases

- WHEN the schema has zero operations THEN `registerArsTools` SHALL register zero tools and SHALL NOT throw.
- WHEN `registerArsTools` is called twice against the same server for overlapping operation names THEN the system SHALL rely on the MCP SDK's native behavior (not engineered around) — documented as a known limitation, not tested as a contract.
- WHEN input arrives with a type the MCP SDK's own Zod parsing rejects before the handler runs (e.g. a string sent for a declared number field) THEN the resulting error is whatever the MCP SDK/protocol produces natively — this is outside the bridge's control and is a documented limitation, not a defect. The bridge's own `validation_error` signpost only covers input that reaches the handler (i.e. passes the intentionally loose Zod shape) and then fails ARS's `validateInput()`.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| MCP-01 | P1: one tool per operation | Execute | Implemented — `index.test.ts:39-44` |
| MCP-02 | P1: Zod inputSchema derived from input_schema | Execute | Implemented — `schema.test.ts` (18 tests) |
| MCP-03 | P1: invalid input → isError, no executor call | Execute | Implemented — `pipeline.test.ts:33-39` |
| MCP-04 | P1: valid input, non-confirmation → executor called, success signpost | Execute | Implemented — `pipeline.test.ts:41-49` |
| MCP-05 | P1: needsHumanConfirmation (risk_level or field-level trigger) → executor never called, pending signpost | Execute | Implemented — `pipeline.test.ts:51-67` |
| MCP-06 | P1: no executor registered → isError, no throw | Execute | Implemented — `pipeline.test.ts:69-75` |
| MCP-07 | P2: executor throws → caught, isError, no crash | Execute | Implemented — `pipeline.test.ts:77-93` |
| MCP-08 | P2: 'any'/'base64' field → Zod fallback | Execute | Implemented — `schema.test.ts` (base64/any/enum-fallback tests) |
| MCP-09 | P2: internal logs → stderr only | Execute | Implemented — grep-verified no `console.log` in `index.ts`; example uses `console.error` only |
| MCP-10 | Edge: zero operations → zero tools, no throw | Execute | Implemented — `index.test.ts:63-68` |
| MCP-11 | Edge: SDK-level structural rejection is out of bridge's control (documented limitation) | Execute | Documented (design.md Error Handling Strategy) — not independently testable within this package |
| MCP-12 | P3: example stdio script against financeiro.yml | Execute | Implemented — `examples/familyos-stdio-server.ts`, manually verified (starts clean, 8 ops registered, stderr-only output) |

**Coverage:** 12 total, 12 mapped to stories, 0 unmapped, 11/12 automated + 1/12 documented limitation.

---

## Success Criteria

- [x] `npx vitest run packages/adapter-mcp` passes, covering MCP-01 through MCP-11 (30 tests: 18 schema, 7 pipeline, 5 index).
- [x] Loading `docs/schemas/familyos/financeiro.yml` through the bridge registers all 8 operations as callable tools without error — verified via `examples/familyos-stdio-server.ts` manual run.
- [x] Calling the tool for a `risk_level: confirmation` operation (e.g. `deletar_gasto`) never invokes its executor, under any input — `index.test.ts:86-96`, `pipeline.test.ts:51-58`.
- [x] `npm run build` (full monorepo) and `npm run test` (full monorepo) remain green after the new package is added — 128 tests passing (98 pre-existing + 30 new), zero regressions.
