# @agent-ready/adapter-mcp Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/adapter-mcp/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase sampling (`packages/adapter-rest/src/rest.test.ts`, `packages/adapter-sqlite/src/sqlite.test.ts`) and spec. Guidelines found: none (no `AGENTS.md`/`CONTRIBUTING.md`/coverage threshold in `vitest.config.ts`) — strong default applied: domain logic maps 1:1 to spec ACs, every listed edge case has a test.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| `schema.ts` (Zod mapping) | unit | Every ARS field type mapped (string/int/decimal/bool/date/datetime/enum/base64/any), required vs optional, `description` passthrough, enum fallback when `values` missing — 1:1 to MCP-02, MCP-08 | `packages/adapter-mcp/src/*.test.ts` | `npx vitest run packages/adapter-mcp` |
| `pipeline.ts` (orchestration) | unit | Every branch: valid + non-confirmation → executor called + success signpost; invalid input → validation_error, executor NOT called; `needsHumanConfirmation` (both risk_level and field-level trigger) → pending, executor NOT called; no executor registered → isError; executor throws → caught, isError — 1:1 to MCP-03 through MCP-07 | `packages/adapter-mcp/src/*.test.ts` | `npx vitest run packages/adapter-mcp` |
| `index.ts` (`registerArsTools` glue) | unit | One tool registered per operation with correct name/description/inputSchema, via a mocked `McpServer`; zero operations → zero registrations — MCP-01, MCP-10 | `packages/adapter-mcp/src/*.test.ts` | `npx vitest run packages/adapter-mcp` |
| `types.ts` (pure type defs) | none | — (build gate only) | — | build gate only |
| example script (P3) | none | Manual verification only (AC: "WHEN run THEN starts a stdio MCP server") — not unit-tested code | — | manual run |

## Parallelism Assessment

> Generated from codebase — confirm before Execute.

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --- | --- | --- | --- |
| unit (all layers above) | Yes | Per-test `vi.fn()` mocks (executor functions, mock `McpServer`), no shared DB/global mutable state | `packages/adapter-rest/src/rest.test.ts` and `packages/adapter-sqlite/src/sqlite.test.ts` both re-mock per test via `vi.fn()`/`vi.mocked(...).mockReturnValue(...)`, no module-level shared state |

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After each task with unit tests | `npx vitest run packages/adapter-mcp` |
| Full | After phase completion | `npm run test` (root — full monorepo, 98 existing tests + new) |
| Build | Final task / before Verifier | `npm run build` (root, all workspaces) then `npm run test` (root) |

---

## Execution Plan

### Phase 1: Foundation (Sequential)

```
T1
```

### Phase 2: Core Modules (Parallel OK)

```
       ┌→ T2 ─┐
T1 ────┼→ T3 ─┼──→ T4
```

### Phase 3: Integration (Sequential)

```
T4 → T5 → T6
```

---

## Task Breakdown

### T1: Scaffold `@agent-ready/adapter-mcp` package + shared types

**What**: Create the package skeleton (`package.json`, `tsconfig.json`) mirroring `adapter-rest`/`adapter-sqlite` conventions; install `@modelcontextprotocol/sdk` (peer + dev dep, type-only usage) and `zod` (real dependency); write `src/types.ts` with `ExecutorFn`, `ExecutorMap`, `McpToolResult`. Resolve the flagged uncertainty from design.md by inspecting the installed SDK's `.d.ts` for `registerTool`'s `inputSchema` parameter type (`ZodRawShape` vs `ZodObject`) and recording the answer in this task's notes for T4 to use.
**Where**: `packages/adapter-mcp/package.json`, `packages/adapter-mcp/tsconfig.json`, `packages/adapter-mcp/src/types.ts`
**Depends on**: None
**Reuses**: `packages/adapter-rest/package.json`, `packages/adapter-rest/tsconfig.json` (structure)
**Requirement**: MCP-01 (enabling), design.md Components → `types.ts`

**Tools**:
- MCP: NONE
- Skill: NONE (tlc-spec-driven already active)

**Done when**:
- [ ] `packages/adapter-mcp/package.json` created: `type: module`, `main`/`types` pointing at `dist/`, `peerDependencies`/`devDependencies` on `@agent-ready/core: "*"` and `@modelcontextprotocol/sdk`, real `dependencies` on `zod`
- [ ] `packages/adapter-mcp/tsconfig.json` extends `../../tsconfig.base.json` (same shape as `adapter-rest`)
- [ ] `npm install` from repo root succeeds, `node_modules/@agent-ready/adapter-mcp` symlink exists
- [ ] `src/types.ts` exports `ExecutorFn`, `ExecutorMap`, `McpToolResult` exactly as specified in design.md
- [x] Installed SDK's `registerTool` `inputSchema` type confirmed by reading its `.d.ts`: `@modelcontextprotocol/sdk@1.29.0`, `inputSchema?: ZodRawShapeCompat` = `Record<string, AnySchema>` — raw shape, not `z.object()`. `schema.ts` (T2) and `index.ts` (T4) use this directly, no wrapping.
- [ ] `npx tsc --noEmit -p packages/adapter-mcp` passes with no errors

**Tests**: none (config/type-only layer per matrix)
**Gate**: build (`npx tsc --noEmit -p packages/adapter-mcp`)

**Commit**: `chore(adapter-mcp): scaffold package and shared types`

---

### T2: Implement `schema.ts` — ARS field → Zod mapping [P]

**What**: Implement `inputFieldsToZodShape(fields: InputField[])` and `operationInputSchema(operation: Operation)` exactly per the mapping table in design.md — deliberately excluding `gt`/`gte`/`min`/`max`/`min_length`/`max_length` from the Zod schema (Tech Decision). Both return a raw `Record<string, z.ZodTypeAny>` shape (confirmed in T1 — matches SDK's `ZodRawShapeCompat`, no `z.object()` wrapping). Write unit tests covering every field type and the required/optional/description/enum-fallback branches.
**Where**: `packages/adapter-mcp/src/schema.ts`, `packages/adapter-mcp/src/schema.test.ts`
**Depends on**: T1
**Reuses**: `OperationHandle.fields` / `getInputFields` normalization from `@agent-ready/core`
**Requirement**: MCP-02, MCP-08

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `inputFieldsToZodShape` maps all 9 ARS field types (`string`, `int`, `decimal`, `bool`, `date`, `datetime`, `enum`, `base64`, `any`) per the design.md table
- [ ] `required: false`/absent fields wrapped in `.optional()`; `required: true` fields are not
- [ ] `description` present → `.describe(field.description)`
- [ ] `enum` field with empty/undefined `values` falls back to `z.string()`
- [ ] No `.gt()`/`.gte()`/`.min()`/`.max()` constraint chaining anywhere in the output (Tech Decision compliance — explicit test asserting this)
- [ ] Gate check passes: `npx vitest run packages/adapter-mcp`
- [ ] Test count: at least 10 tests pass (one per field type + required/optional + description + enum-fallback + no-constraints assertion)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(adapter-mcp): map ARS input fields to Zod schema`

---

### T3: Implement `pipeline.ts` — governance orchestration [P]

**What**: Implement `runOperation(op, executor, rawInput, context?)` exactly per the pseudocode in design.md (`applyDefaults` → `validate` → confirmation gate → executor call → signpost mapping), plus the internal `toMcpResult(signpost, isError)` helper. Write unit tests for every branch.
**Where**: `packages/adapter-mcp/src/pipeline.ts`, `packages/adapter-mcp/src/pipeline.test.ts`
**Depends on**: T1
**Reuses**: `OperationHandle.applyDefaults/.validate/.signpost` from `@agent-ready/core`
**Requirement**: MCP-03, MCP-04, MCP-05, MCP-06, MCP-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Invalid input → `isError: true`, `structuredContent` carries `validation_error` signpost, executor mock NOT called (MCP-03)
- [ ] Valid input, `risk_level` not confirmation, no `human_confirmation_if` triggered → executor mock called once with the defaulted input, `success` signpost returned, `isError: false` (MCP-04)
- [ ] `risk_level: confirmation` operation → executor mock NOT called under any input, `pending` signpost returned, `isError: false` (MCP-05)
- [ ] `validated`-risk operation with a field-level `human_confirmation_if` trigger met (e.g. mirroring `financeiro.yml`'s `valor > 500`) → executor mock NOT called, `pending` signpost returned (MCP-05)
- [ ] Valid input, executor is `undefined` in the map → `isError: true`, message names the operation, no throw (MCP-06)
- [ ] Executor throws → caught, `isError: true`, message contains `err.message`, no stack trace leaked, no uncaught rejection (MCP-07)
- [ ] Gate check passes: `npx vitest run packages/adapter-mcp`
- [ ] Test count: at least 8 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(adapter-mcp): implement governance pipeline orchestration`

---

### T4: Implement `index.ts` — `registerArsTools` MCP glue

**What**: Implement `registerArsTools(server, agent, executors, options?)` wiring `schema.ts` + `pipeline.ts` to `McpServer.registerTool`, using the `inputSchema` type shape confirmed in T1. Write unit tests using a mocked `McpServer` (capturing `registerTool` calls, not a real transport).
**Where**: `packages/adapter-mcp/src/index.ts`, `packages/adapter-mcp/src/index.test.ts`
**Depends on**: T2, T3
**Reuses**: `AgentReady.allOperations`/`.operation()` from `@agent-ready/core`; `operationToZodObject` (T2); `runOperation` (T3)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] One `server.registerTool(...)` call per operation in the loaded schema, name matching `operation.name` (MCP-01)
- [ ] Zero-operation schema → zero `registerTool` calls, no throw (MCP-10)
- [ ] Tool handler passed to `registerTool` delegates to `runOperation` with the correct `OperationHandle`, executor, and `options.context`
- [ ] No `console.log` anywhere in `index.ts` (grep check — stdout must stay clean for stdio transport per design.md Risks)
- [ ] Gate check passes: `npx vitest run packages/adapter-mcp`
- [ ] Test count: at least 4 tests pass

**Tests**: unit
**Gate**: quick

**Commit**: `feat(adapter-mcp): wire registerArsTools to MCP SDK`

---

### T5: P3 example — standalone stdio server against FamilyOS schema

**What**: Write a runnable example script that loads `docs/schemas/familyos/financeiro.yml`, calls `registerArsTools` with in-memory stub executors for each of the 8 operations, and serves over `StdioServerTransport`.
**Where**: `packages/adapter-mcp/examples/familyos-stdio-server.ts`
**Depends on**: T4
**Reuses**: `AgentReady.fromFile`, `registerArsTools` (T4)
**Requirement**: MCP-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Script starts an MCP server over stdio without throwing, using `docs/schemas/familyos/financeiro.yml`
- [ ] All 8 `financeiro.yml` operations have a stub executor wired (even if the stub just returns a canned object)
- [ ] Manually verified: running the script with `npx tsx packages/adapter-mcp/examples/familyos-stdio-server.ts` starts and stays running without error (Ctrl+C to stop) — logged in this task's completion note, not an automated test
- [ ] Script writes no output to stdout (only `console.error` for startup message, per design.md stdio discipline)

**Tests**: none (manual verification per matrix)
**Gate**: manual run

**Commit**: `docs(adapter-mcp): add FamilyOS stdio example server`

---

### T6: Final integration gate + spec/state closeout

**What**: Run the full monorepo build and test suite, confirm nothing regressed, update `.specs/features/adapter-mcp/spec.md` Requirement Traceability statuses to `Implemented`, and update `.specs/STATE.md` Handoff section.
**Where**: `.specs/features/adapter-mcp/spec.md`, `.specs/STATE.md`
**Depends on**: T5
**Reuses**: N/A

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `npm run build` (root) succeeds for all workspaces including the new package
- [ ] `npm run test` (root) passes — 98 pre-existing tests + all new `adapter-mcp` tests, zero regressions
- [ ] `spec.md` traceability table statuses updated
- [ ] `STATE.md` Handoff section updated to reflect Execute complete, ready for Verifier

**Tests**: none (integration gate task)
**Gate**: build

**Commit**: `chore(adapter-mcp): finalize package, close out spec traceability`

---

## Parallel Execution Map

```
Phase 1 (Sequential):
  T1

Phase 2 (Parallel):
  T1 complete, then:
    ├── T2 [P]
    └── T3 [P]

Phase 3 (Sequential):
  T2, T3 complete, then:
    T4 → T5 → T6
```

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Scaffold package + types | 1 package skeleton + 1 type file | ✅ Granular |
| T2: schema.ts mapping | 1 file (+ its test file) | ✅ Granular |
| T3: pipeline.ts orchestration | 1 file (+ its test file) | ✅ Granular |
| T4: index.ts glue | 1 file (+ its test file) | ✅ Granular |
| T5: example script | 1 file | ✅ Granular |
| T6: integration gate + closeout | 2 doc files, no source code | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | No incoming arrow | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T1 → T3 | ✅ Match |
| T4 | T2, T3 | T2 → T4, T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1: Scaffold + types | `types.ts` (config/type-only) | none | none | ✅ OK |
| T2: schema.ts | `schema.ts` (Zod mapping) | unit | unit | ✅ OK |
| T3: pipeline.ts | `pipeline.ts` (orchestration) | unit | unit | ✅ OK |
| T4: index.ts | `index.ts` (glue) | unit | unit | ✅ OK |
| T5: example script | example script | none (manual) | none | ✅ OK |
| T6: integration gate | spec/state docs only | n/a | none | ✅ OK |

All checks pass — no restructuring needed.
