import type {
  AdapterResolvers,
  OperationHandle,
  SignpostResult,
  StateGuard,
} from '@agent-ready/core';
import type { ExecutorFn, McpToolResult } from './types.js';

export type AuditDecision =
  | 'executed'
  | 'validation_error'
  | 'blocked'
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'error';

/** One decision record per runOperation call. */
export interface AuditEvent {
  ts: string;
  operation: string;
  risk_level: string;
  decision: AuditDecision;
  duration_ms: number;
  input_keys: string[];
  audit_fields: Record<string, unknown>;
}

export type AuditSink = (event: AuditEvent) => void;

/** Audit sink that writes each event as one JSON line on stderr. */
export const stderrAuditSink: AuditSink = (event) => {
  process.stderr.write(`${JSON.stringify(event)}\n`);
};

/** The part of McpServer that confirmation through elicitation needs. */
export interface ElicitationHost {
  server?: {
    getClientCapabilities?: () => { elicitation?: unknown } | undefined;
    elicitInput?: (params: {
      message: string;
      requestedSchema: Record<string, unknown>;
    }) => Promise<{ action: string; content?: Record<string, unknown> }>;
  };
}

export interface RunOperationOptions {
  /** MCP server used to ask the human for confirmation through elicitation. */
  server?: ElicitationHost;
  /** Receives one AuditEvent per call; without it, ARS_AUDIT=stderr selects stderrAuditSink, else nothing is written. */
  onAudit?: AuditSink;
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

type Confirmation = 'confirmed' | 'declined' | 'unavailable';

async function askHuman(
  op: OperationHandle,
  input: Record<string, unknown>,
  host: ElicitationHost | undefined,
): Promise<Confirmation> {
  const srv = host?.server;
  if (!srv?.elicitInput || !srv.getClientCapabilities?.()?.elicitation) return 'unavailable';
  try {
    const response = await srv.elicitInput({
      message: op.signpost('pending', input).guidance,
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean' } },
        required: ['confirm'],
      },
    });
    return response.action === 'accept' && response.content?.confirm === true
      ? 'confirmed'
      : 'declined';
  } catch {
    // invariant: a failed or timed-out elicitation never executes; it degrades to pending.
    return 'unavailable';
  }
}

function declinedResult(op: OperationHandle, input: Record<string, unknown>): McpToolResult {
  const pending = op.signpost('pending', input);
  return toMcpResult(
    {
      ...pending,
      guidance: `Operation "${op.definition.name}" was declined by the human and was not executed.`,
      _context: { ...pending._context, what_happened: 'Human declined confirmation' },
      reason: 'The human declined or cancelled the confirmation request.',
      what_to_do: 'Do not retry unless the user asks for it again.',
    },
    false,
  );
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

interface Outcome {
  result: McpToolResult;
  decision: AuditDecision;
  input: Record<string, unknown>;
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
  const started = Date.now();
  const outcome = await decide(op, executor, rawInput, context, options);
  emitAudit(op, rawInput, outcome, Date.now() - started, options.onAudit);
  return outcome.result;
}

async function decide(
  op: OperationHandle,
  executor: ExecutorFn | undefined,
  rawInput: Record<string, unknown>,
  context: Record<string, unknown>,
  options: RunOperationOptions,
): Promise<Outcome> {
  const input = op.applyDefaults(rawInput, context);
  const outcome = (result: McpToolResult, decision: AuditDecision): Outcome => ({
    result,
    decision,
    input,
  });
  const validation = op.validate(input, context);

  if (!validation.valid) {
    return outcome(
      toMcpResult(op.signpost('validation_error', { errors: validation.errors }), true),
      'validation_error',
    );
  }

  const fkErrors = await op.validateForeignKeys(input);
  if (fkErrors.length > 0) {
    return outcome(
      toMcpResult(op.signpost('validation_error', { errors: fkErrors }), true),
      'validation_error',
    );
  }

  const guard = await evaluateGuards(op, input, options.resolvers);
  if (guard && 'error' in guard) {
    return outcome(
      errorResult(
        `State guard for "${op.definition.name}" could not be evaluated: ${guard.error.message}`,
      ),
      'error',
    );
  }
  if (guard) {
    return outcome(
      toMcpResult(
        op.signpost('blocked_transition', {
          ...input,
          reason: guard.blocked.on_fail.message,
          what_to_do: guard.blocked.on_fail.suggest,
        }),
        false,
      ),
      'blocked',
    );
  }

  let confirmed = false;
  // invariant: confirmation is asked through MCP elicitation only when the client advertises it; otherwise the call returns pending.
  if (validation.needsHumanConfirmation) {
    const answer = await askHuman(op, input, options.server);
    if (answer === 'unavailable') {
      return outcome(toMcpResult(op.signpost('pending', input), false), 'pending');
    }
    if (answer === 'declined') return outcome(declinedResult(op, input), 'declined');
    confirmed = true;
  }

  if (!executor) {
    return outcome(
      errorResult(
        `No executor configured for operation "${op.definition.name}". Wire one in the executors map passed to registerArsTools().`,
      ),
      'error',
    );
  }

  let execResult: Record<string, unknown>;
  try {
    execResult = await executor(input);
  } catch (err) {
    return outcome(
      errorResult(`Executor for "${op.definition.name}" failed: ${(err as Error).message}`),
      'error',
    );
  }

  return outcome(
    successResult(applyResponseStrategy(op, op.signpost('success', execResult), execResult)),
    confirmed ? 'confirmed' : 'executed',
  );
}

function emitAudit(
  op: OperationHandle,
  rawInput: Record<string, unknown>,
  outcome: Outcome,
  durationMs: number,
  onAudit: AuditSink | undefined,
): void {
  const sink = onAudit ?? (process.env.ARS_AUDIT === 'stderr' ? stderrAuditSink : undefined);
  if (!sink) return;

  const audit = op.definition.audit;
  const event: AuditEvent = {
    ts: new Date().toISOString(),
    operation: op.definition.name,
    risk_level: op.definition.risk_level,
    decision: outcome.decision,
    duration_ms: durationMs,
    input_keys: Object.keys(rawInput),
    audit_fields: audit ? pick(outcome.input, audit.include_fields ?? []) : {},
  };
  try {
    sink(event);
  } catch {
    // hazard: a failing audit sink must not turn an allowed call into an error.
  }
}
