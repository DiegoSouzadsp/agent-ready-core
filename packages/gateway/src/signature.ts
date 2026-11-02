import { createHash, createHmac } from 'node:crypto';

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
