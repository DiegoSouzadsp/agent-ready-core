/**
 * Collects inbound tokens from repeatable `--token <t>` flags and a comma-separated env value.
 * why: pure so the union/dedupe rules are testable without spawning the bin.
 */
export function resolveInboundTokens(argv: string[], env: NodeJS.ProcessEnv): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--token') continue;
    const value = argv[i + 1];
    // hazard: a dangling --token must not degrade into a gateway with inbound auth silently off.
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      throw new Error('--token requires a value');
    }
    tokens.push(value);
  }
  for (const part of (env.ARS_GATEWAY_TOKENS ?? '').split(',')) tokens.push(part);
  return [...new Set(tokens.map((t) => t.trim()).filter((t) => t !== ''))];
}
