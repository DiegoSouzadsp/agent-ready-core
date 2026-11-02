/**
 * Collects inbound tokens from repeatable `--token <t>` flags and a comma-separated env value.
 * why: pure so the union/dedupe rules are testable without spawning the bin.
 */
export function resolveInboundTokens(argv: string[], env: NodeJS.ProcessEnv): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--token' && argv[i + 1] !== undefined) tokens.push(argv[i + 1]);
  }
  for (const part of (env.ARS_GATEWAY_TOKENS ?? '').split(',')) tokens.push(part);
  return [...new Set(tokens.map((t) => t.trim()).filter((t) => t !== ''))];
}
