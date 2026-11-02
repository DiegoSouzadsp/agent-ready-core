export interface InboundTokenEntry {
  token: string;
  profile?: string;
}

const PROFILE_SUFFIX = /^[A-Za-z0-9_.-]+$/;

/**
 * why: split at the LAST `@`; `=` is not special so base64 padding stays in the token.
 * hazard: a non-empty suffix that is not a valid profile name is a config error, never a silent whole-string token.
 */
function parseEntry(raw: string): InboundTokenEntry {
  const index = raw.lastIndexOf('@');
  if (index <= 0 || index === raw.length - 1) return { token: raw };
  const suffix = raw.slice(index + 1);
  if (!PROFILE_SUFFIX.test(suffix)) {
    throw new Error(`token ${mask(raw.slice(0, index))} has an invalid agent profile "${suffix}" after "@"; profiles match [A-Za-z0-9_.-]+`);
  }
  return { token: raw.slice(0, index), profile: suffix };
}

function mask(token: string): string {
  return `${token.slice(0, 2)}***`;
}

/**
 * why: pure, so the union/dedupe/conflict rules of repeatable `--token <t>[@<profile>]` flags and the comma-separated env value
 * are testable without spawning the bin.
 */
export function resolveInboundTokenEntries(argv: string[], env: NodeJS.ProcessEnv): InboundTokenEntry[] {
  const raws: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--token') continue;
    const value = argv[i + 1];
    // hazard: a dangling --token must not degrade into a gateway with inbound auth silently off.
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      throw new Error('--token requires a value');
    }
    raws.push(value);
  }
  for (const part of (env.ARS_GATEWAY_TOKENS ?? '').split(',')) raws.push(part);

  const byToken = new Map<string, InboundTokenEntry>();
  for (const raw of raws.map((r) => r.trim()).filter((r) => r !== '')) {
    const entry = parseEntry(raw);
    const known = byToken.get(entry.token);
    if (known && known.profile !== entry.profile) {
      // hazard: never echo the whole token; it is a secret.
      throw new Error(`token ${mask(entry.token)} is mapped to conflicting agent profiles ("${known.profile ?? ''}" and "${entry.profile ?? ''}")`);
    }
    if (!known) byToken.set(entry.token, entry);
  }
  return [...byToken.values()];
}
