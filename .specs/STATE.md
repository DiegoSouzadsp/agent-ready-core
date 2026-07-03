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

- **Feature**: adapter-mcp — `.specs/features/adapter-mcp/` — **DONE**
- **Phase / Task**: Complete. Verifier PASS on re-verify pass 1 (`.specs/features/adapter-mcp/validation.md`) — 129 tests, 3/3 discrimination-sensor mutations killed, 12/12 ACs verified.
- **Completed**: Specify, Design, Tasks, Execute (T1-T6), Verify (initial FAIL — 1 surviving mutant + 1 spec-precision gap), Fix (1 commit), Re-verify (PASS)
- **In-progress**: none
- **Next step**: None for this feature. Open items for Diego to decide separately: (1) whether to commit the rest of the monorepo (core/cli/other adapters/apps/earlier hygiene fixes, all still uncommitted from before this feature), (2) npm publish + LICENSE file (flagged earlier in session, still unresolved), (3) whether `.specs/` should be tracked in git long-term.
- **Blockers**: none
- **Uncommitted files**: none for this feature (8 commits total: `eef30e3` T1, `2e85adc` T2, `82a3072` T3, `9c4b977` T4, `4038f8a` T5, `c401a21` T6, `689eb64` fix). Rest of monorepo still uncommitted from before this feature — unrelated, untouched by adapter-mcp work.
- **Branch**: master
