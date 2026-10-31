import type { OperationHandle, SignpostResult } from '@agent-ready/core';
import type { ExecutorFn, McpToolResult } from './types.js';

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

/**
 * Run the full ARS governance pipeline for one MCP tool call:
 * defaults → validate → foreign keys → confirmation gate → executor → signpost.
 *
 * invariant: the executor is never called when validation fails (field-level
 * or FK) or when `needsHumanConfirmation` is true — see AD-002 in .specs/STATE.md.
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
