# STATE

## Decisions

### AD-001
- **Decision**: ARS adapter packages that bridge governance to an external execution surface (MCP tools, and any future transport) receive host-supplied "executor" functions per operation, mirroring the existing `AdapterResolvers` pattern (`packages/core/src/adapter.ts`) — the bridge orchestrates (defaults → validate → confirmation gate → executor → signpost), it never invents its own execution logic.
- **Reason**: Reuses a pattern already proven by `adapter-sqlite`/`adapter-rest`; keeps `@agent-ready/core` free of I/O (existing invariant); makes the exposed tool/endpoint actually perform the action, matching what a consumer of that transport expects.
- **Trade-off**: The host must wire an executor per operation before that operation is callable — operations without one degrade to a clear error, not a silent no-op.
- **Scope**: All current and future ARS adapter packages (`adapter-sqlite`, `adapter-rest`, `adapter-mcp`, ...).
- **Date**: 2026-07-03
- **Status**: active

### AD-002
- **Decision**: When `validateInput()` reports `needsHumanConfirmation: true` (from `risk_level: confirmation` OR a field-level `human_confirmation_if` trigger), adapter bridges to stateless/single-call transports (MCP tool calls, REST single requests) never call the executor on that call — they always return the `pending` signpost instead. No two-step confirmation-token protocol is invented at the adapter layer.
- **Reason**: The core has no concept of "confirmation already given" — `validateInput()` recomputes `needsHumanConfirmation` fresh every call with no state to consult. Inventing a confirmation-token mechanism inside one adapter would diverge from how `core` itself models confirmation (a conversational gate the calling agent enforces, per the TDD's sequence diagram), and would need to be reinvented per-adapter without a shared, core-level primitive.
- **Trade-off**: `risk_level: confirmation` operations (and operations that cross a `human_confirmation_if` threshold) are effectively unreachable through these bridges in V1 — a real limitation, not just a technicality. Revisit if/when `core` gains an actual confirmation-state primitive.
- **Scope**: All current and future ARS adapter packages that expose operations over a stateless, single-call transport.
- **Date**: 2026-07-03
- **Status**: active

### AD-003
- **Decision**: `state_guards` → `Adapter` resolution is NOT automated inside any bridge package. `StateGuard.query` (raw SQL string) and `AdapterResolvers` (named predicates like `'month.is_open'`) remain architecturally disconnected — `OperationHandle.resolveGuard(predicateName, params)` stays a manual, caller-invoked method.
- **Reason**: This tension predates this feature (logged as an open question in the original `docs/implementation_plan.md` TDD: "State guards: SQL legado ou só predicados?"). Resolving it inside an adapter package would lock in an answer that belongs to `@agent-ready/core`.
- **Trade-off**: Bridges accept an optional `Adapter` for forward compatibility but do not evaluate `operation.state_guards` automatically — contextual/confirmation operations' state guards are the executor's own responsibility until `core` resolves this.
- **Scope**: All current and future ARS adapter packages, until superseded by a `core`-level decision on `state_guards` resolution.
- **Date**: 2026-07-03
- **Status**: active

## Handoff

- **Feature**: adapter-mcp — `.specs/features/adapter-mcp/`
- **Phase / Task**: Specify complete (spec.md confirmed by Diego) — entering Design
- **Completed**: Specify
- **In-progress**: Design phase, about to write `design.md`
- **Next step**: Write `design.md` (architecture, components, Zod mapping strategy), present for confirmation, then Tasks
- **Blockers**: none
- **Uncommitted files**: `.specs/features/adapter-mcp/spec.md`, `.specs/STATE.md` (not yet committed to git — this is planning artifact, decide with Diego whether `.specs/` is tracked in the repo)
- **Branch**: master
