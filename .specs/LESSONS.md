# Lessons

> Hand-maintained (no-script fallback — `scripts/lessons.py` not present in this repo). Grounded entries only, one per signal, phrased as general rules. See `C:\Users\diego\.claude\skills\tlc-spec-driven\references\lessons.md` for the intended process this file approximates.

## Confirmed

(none yet — both entries below are first occurrences, tracked as candidates until a second distinct feature corroborates them)

## Candidates

- **L-001** [surviving_mutant] — Feature: `adapter-mcp` — Source: `.specs/features/adapter-mcp/validation.md` Discrimination Sensor mutation 3 (`packages/adapter-mcp/src/index.ts:35`)
  For glue/adapter layers that route calls through a per-operation-name lookup map (e.g. `executors[opDef.name]`), write a test that registers at least two operations with distinct mock handlers and asserts each handler is invoked only for its own operation — tests that only exercise validation-failure or confirmation-gated paths never reach the lookup, so a wrong-key bug there is invisible to the suite.

- **L-002** [spec_precision_gap] — Feature: `adapter-mcp` — Source: `.specs/features/adapter-mcp/validation.md` AC MCP-03 (`packages/adapter-mcp/src/pipeline.test.ts:34-42`)
  When a spec's acceptance criterion says a response's `content`/text field must carry specific guidance or error text, assert that text field directly in the test (e.g. `result.content[0].text`) — asserting only a parallel structured field (e.g. `structuredContent`) leaves the actual text contract unverified even when the implementation is correct by inspection.
