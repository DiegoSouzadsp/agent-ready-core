import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadAgentPolicy,
  loadAgentPolicyFromFile,
  resolveAutonomy,
  type AgentPolicy,
  type AgentDecision,
} from './agent-policy.js';
import * as coreIndex from './index.js';
import type { RiskLevel } from './types.js';

const EXAMPLE = `agent_policy: "1.0"
name: support-bot
autonomy:
  execute_up_to: validated
  ask_up_to: contextual
systems:
  support-tickets:
    execute_up_to: contextual
    operations:
      delete_ticket: deny
`;

function policyYaml(parts: { exec?: string; ask?: string; systems?: string }): string {
  return [
    'agent_policy: "1.0"',
    'name: bot',
    'autonomy:',
    `  execute_up_to: ${parts.exec ?? 'free'}`,
    `  ask_up_to: ${parts.ask ?? 'confirmation'}`,
    parts.systems ?? '',
  ].join('\n');
}

const RISKS: RiskLevel[] = ['free', 'validated', 'contextual', 'confirmation'];

describe('loadAgentPolicy', () => {
  it('loads the documented example', () => {
    expect(loadAgentPolicy(EXAMPLE)).toEqual({
      agent_policy: '1.0',
      name: 'support-bot',
      autonomy: { execute_up_to: 'validated', ask_up_to: 'contextual' },
      systems: {
        'support-tickets': { execute_up_to: 'contextual', operations: { delete_ticket: 'deny' } },
      },
    });
  });

  it('execute_up_to confirmation is rejected', () => {
    expect(() => loadAgentPolicy(policyYaml({ exec: 'confirmation' }))).toThrow(/confirmation.*human/);
    const nested = policyYaml({
      exec: 'free',
      systems: 'systems:\n  s:\n    execute_up_to: confirmation',
    });
    expect(() => loadAgentPolicy(nested)).toThrow(/systems\.s\.execute_up_to.*confirmation.*human/);
  });

  it('execute_up_to above ask_up_to is rejected including the effective per-system value', () => {
    expect(() => loadAgentPolicy(policyYaml({ exec: 'contextual', ask: 'validated' }))).toThrow(/above/);
    const both = policyYaml({
      exec: 'free',
      ask: 'contextual',
      systems: 'systems:\n  s:\n    execute_up_to: contextual\n    ask_up_to: validated',
    });
    expect(() => loadAgentPolicy(both)).toThrow(/systems\.s.*above/);
    const effective = policyYaml({
      exec: 'free',
      ask: 'validated',
      systems: 'systems:\n  s:\n    execute_up_to: contextual',
    });
    expect(() => loadAgentPolicy(effective)).toThrow(/systems\.s.*above/);
  });

  it('every format error class throws and all problems are listed', () => {
    const cases: Array<[string, RegExp]> = [
      ['name: bot\nautonomy: {execute_up_to: free, ask_up_to: free}', /missing required field: agent_policy/],
      ['agent_policy: "2.0"\nname: bot\nautonomy: {execute_up_to: free, ask_up_to: free}', /agent_policy must be "1.0"/],
      ['agent_policy: "1.0"\nautonomy: {execute_up_to: free, ask_up_to: free}', /missing required field: name/],
      ['agent_policy: "1.0"\nname: "a b"\nautonomy: {execute_up_to: free, ask_up_to: free}', /name must match/],
      ['agent_policy: "1.0"\nname: bot\nautonomy: {ask_up_to: free}', /missing required field: autonomy.execute_up_to/],
      ['agent_policy: "1.0"\nname: bot\nautonomy: {execute_up_to: free}', /missing required field: autonomy.ask_up_to/],
      ['agent_policy: "1.0"\nname: bot\nautonomy: {execute_up_to: contextal, ask_up_to: free}', /autonomy.execute_up_to must be one of/],
      [
        'agent_policy: "1.0"\nname: bot\nautonomy: {execute_up_to: free, ask_up_to: free}\nsystems:\n  s:\n    operations:\n      x: maybe',
        /systems\.s\.operations\.x must be one of/,
      ],
      ['a: [unclosed', /Failed to parse YAML/],
    ];
    for (const [yaml, pattern] of cases) {
      expect(() => loadAgentPolicy(yaml)).toThrow(pattern);
    }

    let message = '';
    try {
      loadAgentPolicy('name: "a b"\nautonomy: {execute_up_to: contextal}\nsystems:\n  s:\n    operations:\n      x: maybe');
    } catch (err) {
      message = (err as Error).message;
    }
    for (const part of [
      'missing required field: agent_policy',
      'name must match',
      'autonomy.execute_up_to must be one of',
      'missing required field: autonomy.ask_up_to',
      'systems.s.operations.x must be one of',
    ]) {
      expect(message).toContain(part);
    }
  });

  it('file loader reads a file and names a missing path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ars-agent-policy-'));
    const file = join(dir, 'agent-policy.yml');
    writeFileSync(file, EXAMPLE);
    expect(loadAgentPolicyFromFile(file)).toEqual(loadAgentPolicy(EXAMPLE));
    const missing = join(dir, 'nope.yml');
    expect(() => loadAgentPolicyFromFile(missing)).toThrow(missing);
  });

  it('public exports from the core index', () => {
    expect(coreIndex.loadAgentPolicy).toBe(loadAgentPolicy);
    expect(coreIndex.loadAgentPolicyFromFile).toBe(loadAgentPolicyFromFile);
    expect(coreIndex.resolveAutonomy).toBe(resolveAutonomy);
    const typed: coreIndex.AgentPolicy = loadAgentPolicy(EXAMPLE);
    const decision: coreIndex.AgentDecision = resolveAutonomy(typed, { operation: 'x', risk_level: 'free' });
    expect(decision).toBe('allow');
  });
});

describe('resolveAutonomy', () => {
  const PAIRS: Array<[RiskLevel, RiskLevel]> = [
    ['free', 'free'],
    ['free', 'validated'],
    ['free', 'contextual'],
    ['free', 'confirmation'],
    ['validated', 'validated'],
    ['validated', 'contextual'],
    ['validated', 'confirmation'],
    ['contextual', 'contextual'],
    ['contextual', 'confirmation'],
  ];

  // why: written out literally, not derived from compareRisk, so the table checks the implementation
  const EXPECTED: Record<string, [AgentDecision, AgentDecision, AgentDecision, AgentDecision]> = {
    'free/free': ['allow', 'deny', 'deny', 'deny'],
    'free/validated': ['allow', 'ask', 'deny', 'deny'],
    'free/contextual': ['allow', 'ask', 'ask', 'deny'],
    'free/confirmation': ['allow', 'ask', 'ask', 'ask'],
    'validated/validated': ['allow', 'allow', 'deny', 'deny'],
    'validated/contextual': ['allow', 'allow', 'ask', 'deny'],
    'validated/confirmation': ['allow', 'allow', 'ask', 'ask'],
    'contextual/contextual': ['allow', 'allow', 'allow', 'deny'],
    'contextual/confirmation': ['allow', 'allow', 'allow', 'ask'],
  };

  function policy(exec: RiskLevel, ask: RiskLevel, extra: Partial<AgentPolicy> = {}): AgentPolicy {
    return { agent_policy: '1.0', name: 'bot', autonomy: { execute_up_to: exec, ask_up_to: ask }, ...extra };
  }

  it('truth table risk by ceiling pair', () => {
    let cells = 0;
    for (const [exec, ask] of PAIRS) {
      RISKS.forEach((risk, i) => {
        expect(resolveAutonomy(policy(exec, ask), { operation: 'op', risk_level: risk }), `${exec}/${ask} x ${risk}`)
          .toBe(EXPECTED[`${exec}/${ask}`][i]);
        cells += 1;
      });
    }
    expect(cells).toBe(36);
  });

  it('operation exceptions win over ceilings and stay inside their system', () => {
    const p = policy('free', 'free', {
      systems: { s: { operations: { a: 'deny', b: 'ask', c: 'allow' } } },
    });
    expect(resolveAutonomy(p, { system: 's', operation: 'a', risk_level: 'free' })).toBe('deny');
    expect(resolveAutonomy(p, { system: 's', operation: 'b', risk_level: 'free' })).toBe('ask');
    expect(resolveAutonomy(p, { system: 's', operation: 'c', risk_level: 'contextual' })).toBe('allow');
    expect(resolveAutonomy(p, { system: 't', operation: 'a', risk_level: 'free' })).toBe('allow');
    expect(resolveAutonomy(p, { operation: 'a', risk_level: 'free' })).toBe('allow');
    expect(resolveAutonomy(p, { system: 't', operation: 'c', risk_level: 'contextual' })).toBe('deny');
  });

  it('confirmation is never allow for any policy', () => {
    for (const [exec, ask] of PAIRS) {
      const withException = policy(exec, ask, { systems: { s: { operations: { op: 'allow' } } } });
      expect(resolveAutonomy(withException, { system: 's', operation: 'op', risk_level: 'confirmation' })).toBe('ask');
      const without = resolveAutonomy(policy(exec, ask), { system: 's', operation: 'op', risk_level: 'confirmation' });
      expect(['ask', 'deny']).toContain(without);
    }
  });

  it('system ceilings apply only to their system and inherit the rest', () => {
    const p = policy('validated', 'contextual', { systems: { s: { execute_up_to: 'contextual' } } });
    expect(resolveAutonomy(p, { system: 's', operation: 'op', risk_level: 'contextual' })).toBe('allow');
    expect(resolveAutonomy(p, { system: 't', operation: 'op', risk_level: 'contextual' })).toBe('ask');
    expect(resolveAutonomy(p, { operation: 'op', risk_level: 'contextual' })).toBe('ask');
    expect(resolveAutonomy(p, { system: 's', operation: 'op', risk_level: 'confirmation' })).toBe('deny');

    const askOnly = policy('free', 'free', { systems: { s: { ask_up_to: 'contextual' } } });
    expect(resolveAutonomy(askOnly, { system: 's', operation: 'op', risk_level: 'contextual' })).toBe('ask');
    expect(resolveAutonomy(askOnly, { system: 't', operation: 'op', risk_level: 'contextual' })).toBe('deny');
  });

  it('no policy keeps today behaviour', () => {
    const expected: AgentDecision[] = ['allow', 'allow', 'allow', 'ask'];
    RISKS.forEach((risk, i) => {
      expect(resolveAutonomy(undefined, { system: 's', operation: 'op', risk_level: risk })).toBe(expected[i]);
    });
  });
});
