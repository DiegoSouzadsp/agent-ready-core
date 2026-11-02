#!/usr/bin/env node
/**
 * ars-gateway — standalone ARS gateway process.
 *
 * Usage:
 *   ars-gateway --plugin ./plugins/neorental [--port 8808] [--host 0.0.0.0]
 */
import { startGatewayHttp } from './http.js';
import { resolveInboundTokenEntries } from './bin-args.js';
import { loadAgentPolicySources } from './agent-policies.js';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const pluginDir = argValue('--plugin');
if (!pluginDir) {
  console.error('Usage: ars-gateway --plugin <dir> [--port 8808] [--host 0.0.0.0] [--token <t>[=<profile>]]... [--agent-policy <file|dir>]... [--insecure-no-auth]');
  process.exit(1);
}

function argValues(flag: string): string[] {
  const values: string[] = [];
  process.argv.forEach((arg, index) => {
    if (arg !== flag) return;
    const value = process.argv[index + 1];
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      console.error(`[ars-gateway] ${flag} requires a value`);
      process.exit(1);
    }
    values.push(value);
  });
  return values;
}

let entries: ReturnType<typeof resolveInboundTokenEntries>;
try {
  entries = resolveInboundTokenEntries(process.argv, process.env);
} catch (err) {
  console.error(`[ars-gateway] ${(err as Error).message}`);
  process.exit(1);
}
const inboundTokens = entries.map((entry) => entry.token);
const tokenProfiles: Record<string, string> = {};
for (const entry of entries) if (entry.profile) tokenProfiles[entry.token] = entry.profile;

let agentPolicies: Awaited<ReturnType<typeof loadAgentPolicySources>>;
try {
  agentPolicies = await loadAgentPolicySources(argValues('--agent-policy'));
} catch (err) {
  console.error(`[ars-gateway] failed to start: ${(err as Error).message}`);
  process.exit(1);
}

startGatewayHttp({
  pluginDir,
  port: Number(argValue('--port') ?? 8808),
  host: argValue('--host'),
  inboundTokens,
  agentPolicies,
  tokenProfiles,
  allowInsecureNoAuth: process.argv.includes('--insecure-no-auth'),
})
  .then(({ plugin, port }) => {
    console.log(
      `[ars-gateway] plugin "${plugin.name}" — ${plugin.agent.operations.length} operations — MCP at http://localhost:${port}/mcp (health: /healthz)`,
    );
  })
  .catch((err) => {
    console.error(`[ars-gateway] failed to start: ${(err as Error).message}`);
    process.exit(1);
  });
