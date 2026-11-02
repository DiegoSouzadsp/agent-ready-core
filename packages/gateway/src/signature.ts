import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface SignArsRequestParams {
  secret: string;
  /** Epoch milliseconds, the same value sent in X-ARS-Timestamp. */
  timestamp: number;
  method: string;
  /** pathname + search of the URL actually sent. */
  pathAndQuery: string;
  body: string;
  operation: string;
  decision: string;
}

// invariant: the one place the signed string is assembled; signing and verifying share it so they cannot drift.
function canonicalString(p: Omit<SignArsRequestParams, 'secret'>): string {
  const bodyHash = createHash('sha256').update(p.body ?? '').digest('hex');
  return [String(p.timestamp), p.method.toUpperCase(), p.pathAndQuery, bodyHash, p.operation, p.decision].join('\n');
}

/** Returns `v1=<hex>`: HMAC-SHA256 over the canonical string, keyed by the shared signing secret. */
export function signArsRequest(p: SignArsRequestParams): string {
  return `v1=${createHmac('sha256', p.secret).update(canonicalString(p)).digest('hex')}`;
}

export interface ArsSignedRequest {
  method: string;
  /** Absolute or relative; only pathname + search are used. */
  url: string;
  /** Raw body string exactly as received; null or undefined counts as empty. */
  body?: string | null;
  headers: Record<string, string | string[] | undefined>;
}

export type ArsVerifyResult =
  | { ok: true; operation: string; risk: string; decision: 'executed' | 'confirmed' }
  | { ok: false; reason: 'missing_header' | 'bad_format' | 'expired' | 'bad_signature' };

const DEFAULT_MAX_SKEW_MS = 300_000;
const SIGNATURE_FORMAT = /^v1=[0-9a-f]{64}$/;

/**
 * Checks that a request was signed by an ARS gateway holding `secret` and reports the recorded decision.
 * hazard: X-ARS-Risk is not part of the signed string, so it is returned as received and must not drive authorization.
 */
export function verifyArsSignature(
  req: ArsSignedRequest,
  secret: string,
  opts: { maxSkewMs?: number } = {},
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
  if (!timestampRaw || !operation || !risk || !decision || !signature) {
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

  const parsed = new URL(req.url, 'http://ars.invalid');
  const expected = signArsRequest({
    secret,
    timestamp,
    method: req.method,
    pathAndQuery: parsed.pathname + parsed.search,
    body: req.body ?? '',
    operation,
    decision,
  });
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, operation, risk, decision };
}
