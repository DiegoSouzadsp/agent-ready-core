import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface SignArsRequestParams {
  secret: string;
  /** Epoch milliseconds, the same value sent in X-ARS-Timestamp. */
  timestamp: number;
  /** Random per-request value, the same one sent in X-ARS-Nonce. */
  nonce: string;
  method: string;
  /** pathname + search of the URL actually sent. */
  pathAndQuery: string;
  body: string;
  operation: string;
  risk: string;
  decision: string;
  /** Value of the acting-user header that was sent; empty when none. */
  actingUser?: string;
  /** Agent profile name sent in X-ARS-Agent; empty when the token has no profile. */
  agent?: string;
}

// invariant: the one place the signed string is assembled; signing and verifying share it so they cannot drift.
function canonicalString(p: Omit<SignArsRequestParams, 'secret'>): string {
  const bodyHash = createHash('sha256').update(p.body ?? '').digest('hex');
  return [
    String(p.timestamp),
    p.nonce,
    p.method.toUpperCase(),
    p.pathAndQuery,
    bodyHash,
    p.operation,
    p.risk,
    p.decision,
    p.actingUser ?? '',
    p.agent ?? '',
  ].join('\n');
}

/** Returns `v1=<hex>`: HMAC-SHA256 over the canonical string, keyed by the shared signing secret. */
export function signArsRequest(p: SignArsRequestParams): string {
  return `v1=${createHmac('sha256', p.secret).update(canonicalString(p)).digest('hex')}`;
}

export interface ArsSignedRequest {
  method: string;
  /** Absolute or relative; only pathname + search are used. */
  url: string;
  /** Raw body string exactly as received; anything that is not a string (undefined, null, a parsed `{}`) counts as empty. */
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export type ArsVerifyResult =
  | { ok: true; operation: string; risk: string; decision: 'executed' | 'confirmed'; nonce: string; actingUser: string; agent: string }
  | { ok: false; reason: 'missing_header' | 'bad_format' | 'expired' | 'bad_signature' };

const DEFAULT_MAX_SKEW_MS = 120_000;
const SIGNATURE_FORMAT = /^v1=[0-9a-f]{64}$/;

/**
 * Checks that a request was signed by an ARS gateway holding `secret` and reports the recorded decision.
 * hazard: a valid signature does not prove freshness inside the skew window; the caller must reject a nonce it has already seen.
 */
export function verifyArsSignature(
  req: ArsSignedRequest,
  secret: string,
  opts: { maxSkewMs?: number; actingUserHeader?: string } = {},
): ArsVerifyResult {
  const lowered = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(req.headers)) {
    lowered.set(name.toLowerCase(), Array.isArray(value) ? value[0] : value);
  }
  const timestampRaw = lowered.get('x-ars-timestamp');
  const operation = lowered.get('x-ars-operation');
  const risk = lowered.get('x-ars-risk');
  const decision = lowered.get('x-ars-decision');
  const signature = lowered.get('x-ars-signature');
  const nonce = lowered.get('x-ars-nonce');
  if (!timestampRaw || !operation || !risk || !decision || !signature || !nonce) {
    return { ok: false, reason: 'missing_header' };
  }
  if (!/^\d+$/.test(timestampRaw) || !SIGNATURE_FORMAT.test(signature)) {
    return { ok: false, reason: 'bad_format' };
  }
  if (decision !== 'executed' && decision !== 'confirmed') {
    return { ok: false, reason: 'bad_format' };
  }
  const timestamp = Number(timestampRaw);
  if (Math.abs(Date.now() - timestamp) > (opts.maxSkewMs ?? DEFAULT_MAX_SKEW_MS)) {
    return { ok: false, reason: 'expired' };
  }

  const actingUser = lowered.get((opts.actingUserHeader ?? 'x-acting-user').toLowerCase()) ?? '';
  // invariant: an absent X-ARS-Agent counts as empty; the signature, not the header, tells removal from absence.
  const agent = lowered.get('x-ars-agent') ?? '';
  const parsed = new URL(req.url, 'http://ars.invalid');
  const expected = signArsRequest({
    secret,
    timestamp,
    nonce,
    method: req.method,
    pathAndQuery: parsed.pathname + parsed.search,
    body: typeof req.body === 'string' ? req.body : '',
    operation,
    risk,
    decision,
    actingUser,
    agent,
  });
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, operation, risk, decision, nonce, actingUser, agent };
}
