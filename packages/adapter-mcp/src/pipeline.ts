import type {
  AdapterResolvers,
  OperationHandle,
  SignpostResult,
  StateGuard,
} from '@agent-ready/core';
import type { ExecutorFn, McpToolResult } from './types.js';

export interface RunOperationOptions {
  /** Resolvers that evaluate state_guards; a guard whose predicate is absent here is not enforced. */
  resolvers?: AdapterResolvers;
}

/** Default guard predicate when a StateGuard names none. */
export const DEFAULT_GUARD_PREDICATE = 'sql.query';

function toMcpResult(signpost: SignpostResult, isError: boolean): McpToolResult {
  return {
    content: [{ type: 'text', text: signpost.guidance }],
    structuredContent: signpost as unknown as Record<string, unknown>,
    isError,
  };
}

function successResult(signpost: SignpostResult): McpToolResult {
  const sections = [signpost.guidance, JSON.stringify(signpost.data ?? {})];
  if (signpost.next && signpost.next.length > 0) {
    sections.push(
      `Next: ${signpost.next.map((n) => `${n.operation} (${n.reason})`).join('; ')}`,
    );
  }
  return {
    content: [{ type: 'text', text: sections.join('\n\n') }],
    structuredContent: signpost as unknown as Record<string, unknown>,
    isError: false,
  };
}

function errorResult(text: string): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

function pick(data: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (data[f] !== undefined) out[f] = data[f];
  return out;
}

function applyResponseStrategy(
  op: OperationHandle,
  signpost: SignpostResult,
  execResult: Record<string, unknown>,
): SignpostResult {
  const strategy = op.definition.response_strategy;
  if (strategy?.mode !== 'summary' || !strategy.summary_fields) return signpost;

  const next = [...(signpost.next ?? [])];
  if (strategy.detail_operation) {
    next.push({
      operation: strategy.detail_operation,
      reason: strategy.guidance ?? 'Call for the full details of this result.',
    });
  }
  return { ...signpost, data: pick(execResult, strategy.summary_fields), next };
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  // why: SQLite has no boolean type, so a declared `true` arrives as 1.
  if (typeof expected === 'boolean' && typeof actual === 'number') return actual === (expected ? 1 : 0);
  if (typeof actual === 'boolean' && typeof expected === 'number') return expected === (actual ? 1 : 0);
  return false;
}

function guardPasses(result: unknown, assertion: Record<string, unknown>): boolean {
  const entries = Object.entries(assertion);
  if (entries.length === 0) return true;
  const row = Array.isArray(result) ? result[0] : result;
  if (row === null || typeof row !== 'object') return false;
  return entries.every(([key, expected]) => sameValue((row as Record<string, unknown>)[key], expected));
}

type GuardOutcome = { blocked: StateGuard } | { error: Error } | null;

async function evaluateGuards(
  op: OperationHandle,
  input: Record<string, unknown>,
  resolvers: AdapterResolvers | undefined,
): Promise<GuardOutcome> {
  for (const guard of op.definition.state_guards ?? []) {
    const resolver = resolvers?.[guard.predicate ?? DEFAULT_GUARD_PREDICATE];
    if (!resolver) continue;
    try {
      const result = await resolver({ ...input, query: guard.query });
      if (!guardPasses(result, guard.assert)) return { blocked: guard };
    } catch (err) {
      // invariant: a guard that cannot be evaluated blocks the call rather than letting it through.
      return { error: err as Error };
    }
  }
  return null;
}

/**
 * invariant: the pipeline order is defaults → validate → foreign keys → state guards
 * → confirmation gate → executor → signpost, and the executor is never called when validation fails (field-level
 * or FK), a state guard fails, or `needsHumanConfirmation` is true — see AD-002
 * in .specs/STATE.md. Guards run only for predicates present in `options.resolvers`.
 *
 * FK validation runs only when the schema declares foreign_key fields AND the
 * adapter registers the FK_PREDICATE ('entity.exists') resolver; otherwise it
 * is a no-op, preserving pre-FK behavior.
 */
export async function runOperation(
  op: OperationHandle,
  executor: ExecutorFn | undefined,
  rawInput: Record<string, unknown>,
  context: Record<string, unknown> = {},
  options: RunOperationOptions = {},
): Promise<McpToolResult> {
  const input = op.applyDefaults(rawInput, context);
  const result = op.validate(input, context);

  if (!result.valid) {
    return toMcpResult(op.signpost('validation_error', { errors: result.errors }), true);
  }

  const fkErrors = await op.validateForeignKeys(input);
  if (fkErrors.length > 0) {
    return toMcpResult(op.signpost('validation_error', { errors: fkErrors }), true);
  }

  const guard = await evaluateGuards(op, input, options.resolvers);
  if (guard && 'error' in guard) {
    return errorResult(
      `State guard for "${op.definition.name}" could not be evaluated: ${guard.error.message}`,
    );
  }
  if (guard) {
    return toMcpResult(
      op.signpost('blocked_transition', {
        ...input,
        reason: guard.blocked.on_fail.message,
        what_to_do: guard.blocked.on_fail.suggest,
      }),
      false,
    );
  }

  if (result.needsHumanConfirmation) {
    return toMcpResult(op.signpost('pending', input), false);
  }

  if (!executor) {
    return errorResult(
      `No executor configured for operation "${op.definition.name}". Wire one in the executors map passed to registerArsTools().`,
    );
  }

  let execResult: Record<string, unknown>;
  try {
    execResult = await executor(input);
  } catch (err) {
    return errorResult(`Executor for "${op.definition.name}" failed: ${(err as Error).message}`);
  }

  return successResult(applyResponseStrategy(op, op.signpost('success', execResult), execResult));
}
