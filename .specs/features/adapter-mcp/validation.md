# adapter-mcp Validation

**Date**: 2026-07-03
**Spec**: `.specs/features/adapter-mcp/spec.md`
**Diff range**: `3afff58..HEAD` (6 commits: `eef30e3`, `2e85adc`, `82a3072`, `9c4b977`, `4038f8a`, `c401a21`)
**Verifier**: independent sub-agent (author ≠ verifier)
**Status**: ✅ PASS (see "Re-Verify Pass 1" below — both Minor gaps from the initial pass are resolved as of commit `689eb64`)

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1: Scaffold package + types | ✅ Done | `package.json`/`tsconfig.json` mirror `adapter-rest`; `types.ts` exports `ExecutorFn`/`ExecutorMap`/`McpToolResult` |
| T2: `schema.ts` | ✅ Done | 18 tests, all 9 field types + required/optional/description/enum-fallback/no-constraints covered |
| T3: `pipeline.ts` | ✅ Done | 7 tests, all 6 branches covered including both `needsHumanConfirmation` triggers |
| T4: `index.ts` | ✅ Done | 5 tests; registration/zero-op covered — **see Sensor mutation 3**: executor-wiring correctness on the success path is not independently tested at this layer |
| T5: example script | ✅ Done | `examples/familyos-stdio-server.ts`, all 8 `financeiro.yml` operations stubbed, `console.error`-only |
| T6: integration gate + closeout | ✅ Done | `spec.md`/`STATE.md` updated, only doc files touched |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| MCP-01: `registerArsTools` registers one tool per operation, named after `operation.name` | `registerTool` called once per op, name == op name | `packages/adapter-mcp/src/index.test.ts:41-50` — `expect(server.registerTool).toHaveBeenCalledTimes(2); expect(registeredNames.sort()).toEqual(['deletar_gasto','registrar_gasto'])` | ✅ PASS |
| MCP-02: `inputSchema` derived from `input_schema` (type/required/enum/description); constraints excluded | Zod shape reflects type/required/enum/description only, no `gt/gte/min/max/min_length/max_length` | `packages/adapter-mcp/src/schema.test.ts:10-94` (per-type + required + description) and `:96-105` — `expect(shape.valor.safeParse(1).success).toBe(true)` for a `gt:500` field | ✅ PASS |
| MCP-03: invalid input → `isError:true`, executor not called | `isError:true`, `validation_error` signpost content w/ field errors, executor never called | `packages/adapter-mcp/src/pipeline.test.ts:34-42` — `expect(result.isError).toBe(true); expect((result.structuredContent as any).errors[0].field).toBe('valor'); expect(executor).not.toHaveBeenCalled()` | ⚠️ Spec-precision gap — test asserts `structuredContent.errors[0].field` but never asserts `content[0].text` (the AC's "content containing... guidance") actually carries the guidance/field-error text; correct by code inspection (`toMcpResult` sets `content[0].text = signpost.guidance`, and `guidance` embeds `reason + what_to_do`, `packages/core/src/signpost.ts:178`), but not directly asserted |
| MCP-04: valid input, non-confirmation → executor called w/ post-defaults input, `success` signpost, `isError:false` | executor called once w/ defaulted input; `success` signpost; `isError:false` | `packages/adapter-mcp/src/pipeline.test.ts:44-53` — `expect(executor).toHaveBeenCalledWith({ valor: 50, origem: 'mcp' }); expect(result.isError).toBe(false); expect((result.structuredContent as any).type).toBe('success')` | ✅ PASS |
| MCP-05: `needsHumanConfirmation` (risk_level:confirmation OR field-level `human_confirmation_if`) → executor never called, `pending` signpost | executor never called under either trigger; `pending` signpost, `isError:false` | risk_level path: `pipeline.test.ts:55-62`; field-level path (validated-risk op, `valor>500`): `pipeline.test.ts:64-71` — both assert `expect(executor).not.toHaveBeenCalled(); expect((result.structuredContent as any).type).toBe('pending')` | ✅ PASS — both triggers independently covered, per the corrected AC |
| MCP-06: valid input, no executor registered → `isError:true`, names operation, no throw | error message names the operation, no throw | `packages/adapter-mcp/src/pipeline.test.ts:73-79` — `expect(result.content[0].text).toContain('registrar_gasto_test'); expect(result.content[0].text.toLowerCase()).toContain('no executor')` | ✅ PASS |
| MCP-07: executor throws/rejects → caught, `isError:true`, no crash | caught, `isError:true`, safe message, no uncaught rejection | `pipeline.test.ts:81-89` (async reject) and `:91-99` (sync throw) — `expect(result.content[0].text).toContain('db connection lost'/'sync boom')` | ✅ PASS |
| MCP-08: `any`/`base64` fields → Zod fallback `z.any()`/`z.string()` | fallback types accept arbitrary values | `schema.test.ts:63-66` (base64) and `:68-72` (any) — `expect(shape.foto.safeParse('aGVsbG8=').success).toBe(true); expect(shape.payload.safeParse({x:1}).success).toBe(true)` | ✅ PASS |
| MCP-09: internal logs → `stderr` only, never `stdout` | no `console.log`/`.warn`/`.info` in package source | Verified by direct grep (not a unit test): `grep -rn "console\.(log|warn|info)" packages/adapter-mcp` → 0 matches; `console.error` used only in `examples/familyos-stdio-server.ts:45,49` | ✅ PASS (inspection-verified, no automated test asserts this — matches Test Coverage Matrix, which doesn't require one) |
| MCP-10: zero operations → zero tools registered, no throw | `registerTool` never called, no throw | `packages/adapter-mcp/src/index.test.ts:64-70` — `expect(() => registerArsTools(...)).not.toThrow(); expect(server.registerTool).not.toHaveBeenCalled()` | ✅ PASS |
| MCP-11: SDK-level structural rejection is outside bridge's control | documented limitation, not independently testable in this package | `design.md` Error Handling Strategy table, row "MCP SDK rejects input before handler runs" | ✅ PASS (documented, not testable — matches spec's own framing) |
| MCP-12: example stdio script against `financeiro.yml` | starts an MCP server over stdio, all 8 ops registered, stdout clean | `packages/adapter-mcp/examples/familyos-stdio-server.ts` (8 executors wired lines 25-34); manual-run claim in spec/tasks not independently re-run by this Verifier (matches "manual verification only" in Test Coverage Matrix) | ✅ PASS (manual-verification criterion, code present and structurally correct) |

**Status**: ⚠️ 11/12 clean PASS, 1 spec-precision gap (MCP-03 — `content[0].text` guidance not directly asserted, though correct by inspection), 0 uncovered/missing ACs.

---

## Discrimination Sensor

| Mutation | File:line | Description | Killed? |
| --- | --- | --- | --- |
| 1 | `packages/adapter-mcp/src/pipeline.ts:40` | Flipped confirmation gate: `if (result.needsHumanConfirmation)` → `if (!result.needsHumanConfirmation)` | ✅ Killed — 7/30 tests failed (`pipeline.test.ts`) |
| 2 | `packages/adapter-mcp/src/schema.ts:56` | Flipped optional-wrapping condition: `if (!field.required)` → `if (field.required)` | ✅ Killed — 4/30 tests failed (`schema.test.ts`) |
| 3 | `packages/adapter-mcp/src/index.ts:35` | Broke operation-name→executor wiring: `executors[opDef.name]` → `executors[opDef.name + '_wrong']` | ❌ **Survived** — 30/30 tests still passed |

**Sensor depth**: lightweight (3 targeted mutations)
**Result**: 2/3 killed — ❌ FAIL (one surviving mutant)

**Root cause of survival**: `index.test.ts` has no test that (a) supplies **valid** input to a **non-confirmation** operation through the full `registerArsTools` → registered-handler path and (b) asserts the **correct** executor was invoked with the correct data. The two existing integration-style tests in `index.test.ts` (`:72-84` invalid input, `:86-98` confirmation-risk op) both hit branches where the executor is never called regardless of which key is used to look it up, so a wrong-key wiring bug at the `index.ts` glue layer is invisible to the current suite. The equivalent correctness is verified only at the `pipeline.ts` unit level (`pipeline.test.ts:44-53`), which bypasses `index.ts`'s `executors[opDef.name]` lookup entirely.

All mutations restored (`git checkout --`); working tree confirmed clean before/after each mutation and at sensor completion.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ — `schema.ts`/`pipeline.ts`/`index.ts` are each single-purpose, no dead code |
| Surgical changes | ✅ — diff touches only `packages/adapter-mcp/**` and `.specs/**`; T6 touches only `spec.md`/`STATE.md` |
| No scope creep | ✅ — no changes to `adapter-rest`, `adapter-sqlite`, or `core` |
| Matches patterns | ✅ — `package.json`/`tsconfig.json` byte-for-byte structural match to `adapter-rest`; test style (`vi.fn()` per-test mocks, no shared state) matches `rest.test.ts`/`sqlite.test.ts` |
| Spec-anchored outcome check (asserted values match spec) | ⚠️ — see MCP-03 spec-precision gap above |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ⚠️ — `pipeline.ts` (domain logic) has 1:1 AC coverage; `index.ts` (glue layer) covers registration/zero-op/invalid-input/confirmation-op but is missing the happy-path (valid input, non-confirmation op) integration test — the gap Sensor mutation 3 exposes |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — all 30 tests trace to MCP-01/02/03/04/05/06/07/08 or edge cases |
| Documented guidelines followed | none found in repo (no `AGENTS.md`/`CONTRIBUTING.md`/coverage threshold) — strong defaults applied, consistent with `tasks.md`'s own stated finding |

---

## Edge Cases

- [x] Zero operations → zero tools, no throw — `index.test.ts:64-70`
- [x] `registerArsTools` called twice, overlapping names → documented as SDK-native behavior, not engineered around (design.md, spec.md Out of Scope) — not tested, matches spec's explicit framing as "not a contract"
- [x] SDK-level structural type rejection before handler runs → documented limitation (design.md Error Handling Strategy)

---

## AD-002 Constraint Check (extra scrutiny)

Confirmed: `packages/adapter-mcp/src/pipeline.test.ts:64-71` uses `validatedOp` (`risk_level: 'validated'`, **not** `'confirmation'`) with a field-level `human_confirmation_if: { gt: 500 }` on `valor`, calls with `{ valor: 600 }`, and asserts `executor` is never called and the `pending` signpost is returned. This directly proves the mid-spec correction (AC5/MCP-05 covering both triggers, not just `risk_level:confirmation`) is implemented and tested at the `pipeline.ts` layer. Not independently re-tested at the `index.ts` layer, but `index.ts` delegates unconditionally to `runOperation`, so the `pipeline.ts` coverage is sufficient evidence for this specific constraint.

---

## Gate Check

- **Gate command**: `npm run build` (root) then `npm run test` (root)
- **Result**: 128 passed, 0 failed, 0 skipped (10 test files)
- **Test count before feature**: 98 (pre-existing; `packages/core`, `adapter-rest`, `adapter-sqlite`, `cli` — none of these were tracked in git at baseline `3afff58`, so the 98 baseline is derived arithmetically: 128 total − 30 new adapter-mcp tests = 98, matching the spec's own claimed baseline)
- **Test count after feature**: 128 (`schema.test.ts`: 18, `pipeline.test.ts`: 7, `index.test.ts`: 5 = 30 new)
- **Delta**: +30 new tests, exactly matching spec claim
- **Skipped tests**: none
- **Failures**: none

---

## Fix Plans

### Fix 1: `index.ts` executor-wiring correctness not independently tested (Sensor mutation 3 survived)

- **Root cause**: `index.test.ts` has no happy-path integration test — valid input on a non-confirmation operation, asserting the *correct* executor (by name) was invoked through the registered handler. Existing tests only exercise paths where the executor is never called (invalid input, confirmation-risk op), so `executors[opDef.name]` vs. any other key produces identical observable behavior in the current suite.
- **Fix task**: Add a test to `packages/adapter-mcp/src/index.test.ts`: register two operations with two distinct executors (`vi.fn()` each), call the handler for one with valid input, and assert (a) that executor was called and (b) the *other* operation's executor was NOT called. This kills the mutation by making the specific `opDef.name` key load-bearing.
- **Priority**: Minor — the underlying behavior is correct (confirmed via the mutation exercise reverting cleanly, and via `pipeline.test.ts`'s equivalent coverage one layer down); this is a test-coverage gap at the glue layer, not a functional defect. Does not block MCP-01/04's spec-anchored PASS since `pipeline.ts` proves the executor-invocation contract independently — but the `index.ts` *wiring* of that contract is currently unverified by any test.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| MCP-01 | Implemented | ✅ Verified |
| MCP-02 | Implemented | ✅ Verified |
| MCP-03 | Implemented | ✅ Verified (Re-Verify Pass 1: content[0].text now directly asserted against non-empty guidance) |
| MCP-04 | Implemented | ✅ Verified |
| MCP-05 | Implemented | ✅ Verified (both triggers) |
| MCP-06 | Implemented | ✅ Verified |
| MCP-07 | Implemented | ✅ Verified |
| MCP-08 | Implemented | ✅ Verified |
| MCP-09 | Implemented | ✅ Verified (inspection) |
| MCP-10 | Implemented | ✅ Verified |
| MCP-11 | Documented | ✅ Verified (documented limitation, as designed) |
| MCP-12 | Implemented | ✅ Verified (manual-verification criterion) |

---

## Summary

**Overall**: ⚠️ Issues (one surviving mutant, one minor spec-precision gap — both non-blocking for the core governance guarantees, which are proven correct at `pipeline.ts`)

**Spec-anchored check**: 11/12 ACs cleanly matched spec outcome, 1 spec-precision gap (MCP-03)
**Sensor**: 2/3 mutations killed, 1 survived
**Gate**: 128 passed, 0 failed, +30 delta exactly as claimed

**What works**: Full governance pipeline (defaults → validate → confirmation gate → executor → signpost) is correctly implemented and unit-tested at the `pipeline.ts` layer, including the corrected AC5/MCP-05 covering both `risk_level:confirmation` and field-level `human_confirmation_if` triggers (AD-002 compliance directly proven). Zod schema mapping excludes constraints per Tech Decision, verified by explicit test. Package scaffolding matches sibling adapter conventions exactly. No scope creep — diff strictly limited to `packages/adapter-mcp/**` and spec docs. `console.log` absent from package source (stdio-safety).

**Issues found**:
1. `index.ts`'s `executors[opDef.name]` wiring is not independently proven correct by any test that both (a) reaches the executor-call branch and (b) would fail if the wrong executor were invoked — see Fix 1.
2. MCP-03's test doesn't directly assert `content[0].text` carries the guidance/field-error text the AC describes — only `structuredContent` is asserted; correct by code inspection but not by test assertion.

**Next steps**: Route Fix 1 as a fix task to an implementer (add one `index.test.ts` case proving correct-executor invocation on the happy path); optionally strengthen MCP-03's existing test with a `content[0].text` assertion. Both are low-severity (Minor) — the underlying governance behavior is not in doubt, only test-layer discrimination at the glue level. Does not warrant blocking the feature, but should close before treating `index.ts` as fully sensor-verified.

---

## Re-Verify Pass 1

**Date**: 2026-07-03
**Commit under test**: `689eb64` — `test(adapter-mcp): fix Verifier-found gaps in executor wiring and MCP-03`
**Scope**: Targeted re-verify of the two Minor gaps from the original pass (surviving mutant on `index.ts:35`'s executor lookup; MCP-03 spec-precision gap on `content[0].text`). Not a full re-audit — the other two mutations (confirmation-gate flip, optional-wrapping flip) were not re-run, per instructions, since they already passed and are unchanged by this fix.

### Diff reviewed

`git diff HEAD~1 HEAD -- packages/adapter-mcp/src/index.test.ts packages/adapter-mcp/src/pipeline.test.ts` confirms:

- **`index.test.ts`**: new test `'wires each operation to its own executor by name — valid input invokes only the matching executor, not another operation's'` (lines 86-105). Registers a two-operation schema (`TWO_OP_SCHEMA`) with two distinct `vi.fn()` executors (`registrarExecutor`, `deletarExecutor`), invokes the `registrar_gasto` handler with valid input, and asserts `result.isError` is `false`, `registrarExecutor` was called exactly once with `{ valor: 50 }`, and `deletarExecutor` was **not** called.
- **`pipeline.test.ts`**: MCP-03 test (lines 34-43) gained two new assertions — `expect(result.content[0].text).toBe((result.structuredContent as any).guidance)` and `expect(result.content[0].text.length).toBeGreaterThan(0)` — directly tying `content[0].text` to the non-empty guidance text.

### Discrimination sensor re-run (mutation 3 only)

- Edited `packages/adapter-mcp/src/index.ts:35`: `executors[opDef.name]` → `executors[opDef.name + '_wrong']`.
- Ran `npx vitest run packages/adapter-mcp` from repo root.
- **Result**: 1 test failed — the new wiring test in `index.test.ts` (`AssertionError: expected true to be false` on `result.isError`, since the mutated lookup resolves to `undefined` and the pipeline falls through to the "no executor registered" (MCP-06) path). All other 30 tests in `packages/adapter-mcp` still passed. **Mutant killed.**
- Restored the file: `git checkout -- packages/adapter-mcp/src/index.ts`. Confirmed `git diff --stat packages/adapter-mcp/src/index.ts` produced no output (clean).

**Sensor result**: mutation 3 now ✅ Killed (was ❌ Survived). Combined with the two previously-killed mutations (not re-run, unchanged), sensor is now 3/3 killed.

### MCP-03 spec-precision gap re-check

`pipeline.test.ts:34-43`'s test now asserts `result.content[0].text` equals `(result.structuredContent as any).guidance` (the exact string the AC's "content containing... guidance" refers to) **and** that this string has non-zero length — ruling out a vacuous pass where `guidance` and `content[0].text` are both empty strings. This directly closes the original gap: the AC's guidance-text requirement is now proven by assertion, not just by code inspection.

### Gate re-run

- `npm run build` (root): succeeded, exit 0 (unrelated Vite app bundle-size warnings only, no errors).
- `npm run test` (root): **129 passed, 0 failed, 0 skipped** (10 test files) — exactly 128 (prior baseline) + 1 new test, matching the fix's stated scope (one new test added, one existing test strengthened with additional assertions, no new test files).

### Updated Discrimination Sensor table

| Mutation | File:line | Description | Killed? |
| --- | --- | --- | --- |
| 1 | `packages/adapter-mcp/src/pipeline.ts:40` | Flipped confirmation gate | ✅ Killed (unchanged from original pass, not re-run) |
| 2 | `packages/adapter-mcp/src/schema.ts:56` | Flipped optional-wrapping condition | ✅ Killed (unchanged from original pass, not re-run) |
| 3 | `packages/adapter-mcp/src/index.ts:35` | Broke operation-name→executor wiring | ✅ **Killed** (re-run this pass — new `index.test.ts` wiring test fails under mutation) |

**Sensor result (updated)**: 3/3 killed — ✅ PASS

### Re-Verify Summary

**Overall**: ✅ PASS — both Minor gaps from the original report are resolved. No new issues found within the scope of this fix.

1. Surviving mutant (index.ts executor wiring): **Resolved.** New test independently proves the `opDef.name` key is load-bearing.
2. MCP-03 spec-precision gap: **Resolved.** New assertions directly tie `content[0].text` to the non-empty guidance text.

**Gate**: 129 passed, 0 failed, 0 skipped — +1 exactly as expected.

**Feature status**: adapter-mcp is now fully sensor-verified and spec-verified. No blocking or non-blocking issues remain from this Verifier's review.
