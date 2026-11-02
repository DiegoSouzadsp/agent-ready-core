import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { RiskLevel } from './types.js';
import { compareRisk } from './risk.js';

export type AgentDecision = 'allow' | 'ask' | 'deny';

export interface AgentAutonomy {
  execute_up_to: RiskLevel;
  ask_up_to: RiskLevel;
}

export interface AgentSystemPolicy {
  execute_up_to?: RiskLevel;
  ask_up_to?: RiskLevel;
  operations?: Record<string, AgentDecision>;
}

/** Operator-side tolerance of one agent, in the same vocabulary as the system's risk levels. */
export interface AgentPolicy {
  agent_policy: '1.0';
  name: string;
  autonomy: AgentAutonomy;
  systems?: Record<string, AgentSystemPolicy>;
}

const LEVELS: readonly RiskLevel[] = ['free', 'validated', 'contextual', 'confirmation'];
const DECISIONS: readonly AgentDecision[] = ['allow', 'ask', 'deny'];
const NAME_RE = /^[A-Za-z0-9_.-]+$/;

const DEFAULT_AUTONOMY: AgentAutonomy = { execute_up_to: 'contextual', ask_up_to: 'confirmation' };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isLevel(v: unknown): v is RiskLevel {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}

function checkLevel(
  value: unknown,
  path: string,
  problems: string[],
  isExecute: boolean,
): RiskLevel | undefined {
  if (!isLevel(value)) {
    problems.push(`${path} must be one of ${LEVELS.join(', ')}`);
    return undefined;
  }
  if (isExecute && value === 'confirmation') {
    problems.push(`${path} cannot be confirmation: confirmation always requires a human`);
    return undefined;
  }
  return value;
}

/**
 * Parse and validate an agent-policy.yml document.
 *
 * @throws {Error} listing every problem found
 */
export function loadAgentPolicy(yamlContent: string): AgentPolicy {
  let raw: unknown;
  try {
    raw = parse(yamlContent);
  } catch (err) {
    throw new Error(`[agent-ready] Invalid agent policy:\n- Failed to parse YAML: ${(err as Error).message}`);
  }
  if (!isObject(raw)) {
    throw new Error('[agent-ready] Invalid agent policy:\n- policy must be a YAML object');
  }
  const problems: string[] = [];

  if (raw.agent_policy === undefined) problems.push('missing required field: agent_policy');
  else if (raw.agent_policy !== '1.0') problems.push('agent_policy must be "1.0"');

  if (raw.name === undefined) problems.push('missing required field: name');
  else if (typeof raw.name !== 'string' || !NAME_RE.test(raw.name)) {
    problems.push('name must match [A-Za-z0-9_.-]+');
  }

  let exec: RiskLevel | undefined;
  let ask: RiskLevel | undefined;
  const autonomy = raw.autonomy;
  if (!isObject(autonomy)) {
    problems.push('missing required field: autonomy');
  } else {
    if (autonomy.execute_up_to === undefined) problems.push('missing required field: autonomy.execute_up_to');
    else exec = checkLevel(autonomy.execute_up_to, 'autonomy.execute_up_to', problems, true);
    if (autonomy.ask_up_to === undefined) problems.push('missing required field: autonomy.ask_up_to');
    else ask = checkLevel(autonomy.ask_up_to, 'autonomy.ask_up_to', problems, false);
    if (exec && ask && compareRisk(exec, ask) > 0) {
      problems.push(`autonomy.execute_up_to (${exec}) cannot be above autonomy.ask_up_to (${ask})`);
    }
  }

  const systems: Record<string, AgentSystemPolicy> = {};
  if (raw.systems !== undefined) {
    if (!isObject(raw.systems)) {
      problems.push('systems must be a map of system name to policy');
    } else {
      for (const [sysName, sysRaw] of Object.entries(raw.systems)) {
        const base = `systems.${sysName}`;
        if (!isObject(sysRaw)) {
          problems.push(`${base} must be an object`);
          continue;
        }
        const sys: AgentSystemPolicy = {};
        if (sysRaw.execute_up_to !== undefined) {
          sys.execute_up_to = checkLevel(sysRaw.execute_up_to, `${base}.execute_up_to`, problems, true);
        }
        if (sysRaw.ask_up_to !== undefined) {
          sys.ask_up_to = checkLevel(sysRaw.ask_up_to, `${base}.ask_up_to`, problems, false);
        }
        const effExec = sys.execute_up_to ?? exec;
        const effAsk = sys.ask_up_to ?? ask;
        if ((sys.execute_up_to !== undefined || sys.ask_up_to !== undefined)
          && effExec && effAsk && compareRisk(effExec, effAsk) > 0) {
          problems.push(`${base}: effective execute_up_to (${effExec}) cannot be above effective ask_up_to (${effAsk})`);
        }
        if (sysRaw.operations !== undefined) {
          if (!isObject(sysRaw.operations)) {
            problems.push(`${base}.operations must be a map of operation to ${DECISIONS.join('|')}`);
          } else {
            const ops: Record<string, AgentDecision> = {};
            for (const [opName, decision] of Object.entries(sysRaw.operations)) {
              if (typeof decision === 'string' && (DECISIONS as readonly string[]).includes(decision)) {
                ops[opName] = decision as AgentDecision;
              } else {
                problems.push(`${base}.operations.${opName} must be one of ${DECISIONS.join(', ')}`);
              }
            }
            sys.operations = ops;
          }
        }
        systems[sysName] = sys;
      }
    }
  }

  if (problems.length > 0 || !exec || !ask) {
    throw new Error(`[agent-ready] Invalid agent policy:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  }

  const policy: AgentPolicy = {
    agent_policy: '1.0',
    name: raw.name as string,
    autonomy: { execute_up_to: exec, ask_up_to: ask },
  };
  if (raw.systems !== undefined) policy.systems = systems;
  return policy;
}

/**
 * Load an agent policy from a file path.
 *
 * @throws {Error} if the file is unreadable or the policy is invalid
 */
export function loadAgentPolicyFromFile(path: string): AgentPolicy {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new Error(`[agent-ready] Cannot read agent policy file "${path}": ${(err as Error).message}`);
  }
  return loadAgentPolicy(content);
}

export type AutonomyRule = 'operation' | 'system' | 'base' | 'confirmation' | 'default';

export interface AutonomyExplanation {
  decision: AgentDecision;
  reason: string;
  rule: AutonomyRule;
}

const EXCEPTION_VERB: Record<AgentDecision, string> = { allow: 'allows', ask: 'asks about', deny: 'denies' };

/**
 * why: single source of the decision text, so hook and gateway never word it twice.
 * Order: per-operation exception, execute ceiling, ask ceiling, deny.
 */
export function explainAutonomy(
  policy: AgentPolicy | undefined,
  q: { system?: string; operation: string; risk_level: RiskLevel },
): AutonomyExplanation {
  const systems = policy?.systems ?? {};
  const sys = q.system !== undefined && Object.hasOwn(systems, q.system) ? systems[q.system] : undefined;

  const ops = sys?.operations;
  if (policy && ops && Object.hasOwn(ops, q.operation)) {
    const exception = ops[q.operation];
    // invariant: confirmation never executes without a human, whatever the exception says
    if (exception === 'allow' && q.risk_level === 'confirmation') {
      return {
        decision: 'ask',
        rule: 'confirmation',
        reason: `operation ${q.operation} requires human confirmation; agent policy ${policy.name} cannot grant it`,
      };
    }
    return {
      decision: exception,
      rule: 'operation',
      reason: `agent policy ${policy.name} ${EXCEPTION_VERB[exception]} ${q.operation} explicitly`,
    };
  }

  const base = policy?.autonomy ?? DEFAULT_AUTONOMY;
  const execUpTo = sys?.execute_up_to ?? base.execute_up_to;
  const askUpTo = sys?.ask_up_to ?? base.ask_up_to;

  let decision: AgentDecision = 'deny';
  if (q.risk_level !== 'confirmation' && compareRisk(q.risk_level, execUpTo) <= 0) decision = 'allow';
  else if (compareRisk(q.risk_level, askUpTo) <= 0) decision = 'ask';

  if (!policy) {
    return { decision, rule: 'default', reason: 'no agent policy; default ceiling' };
  }
  const fromSystem = sys?.execute_up_to !== undefined || sys?.ask_up_to !== undefined;
  const verb = decision === 'allow' ? 'allows' : 'does not allow';
  return {
    decision,
    rule: fromSystem ? 'system' : 'base',
    reason: `agent policy ${policy.name} ${verb} ${q.operation} (${q.risk_level}); it executes up to ${execUpTo} and asks up to ${askUpTo}`,
  };
}

export function resolveAutonomy(
  policy: AgentPolicy | undefined,
  q: { system?: string; operation: string; risk_level: RiskLevel },
): AgentDecision {
  return explainAutonomy(policy, q).decision;
}
