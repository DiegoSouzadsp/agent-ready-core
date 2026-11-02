import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAgentPolicyFromFile } from '@agent-ready/core';
import type { AgentPolicy } from '@agent-ready/core';

const POLICY_FILE = /\.ya?ml$/;

/** Loads every policy file in `dir`, alphabetically; a bad file throws naming that file. */
export async function loadPolicyDirectory(dir: string): Promise<AgentPolicy[]> {
  const files = (await readdir(dir)).filter((f) => POLICY_FILE.test(f)).sort();
  return files.map((f) => readPolicyFile(join(dir, f)));
}

function readPolicyFile(path: string): AgentPolicy {
  try {
    return loadAgentPolicyFromFile(path);
  } catch (err) {
    throw new Error(`[gateway] Invalid agent policy "${path}": ${(err as Error).message}`);
  }
}

/** invariant: a profile name identifies exactly one policy; duplicates fail instead of one silently winning. */
export function assertUniquePolicyNames(policies: AgentPolicy[]): void {
  const seen = new Set<string>();
  for (const policy of policies) {
    if (seen.has(policy.name)) throw new Error(`[gateway] Duplicate agent policy name "${policy.name}"`);
    seen.add(policy.name);
  }
}

/** Resolves `--agent-policy` values (files or directories) into policies. */
export async function loadAgentPolicySources(paths: string[]): Promise<AgentPolicy[]> {
  const policies: AgentPolicy[] = [];
  for (const path of paths) {
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new Error(`[gateway] Agent policy path not found: "${path}"`);
    }
    if (info.isDirectory()) policies.push(...(await loadPolicyDirectory(path)));
    else policies.push(readPolicyFile(path));
  }
  assertUniquePolicyNames(policies);
  return policies;
}
