import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { signArsRequest, verifyArsSignature } from './signature.js';
import type { ArsSignedRequest } from './signature.js';
import * as publicApi from './index.js';

describe('signArsRequest', () => {
  it('known-answer vectors fix the v1 format', () => {
    expect(
      signArsRequest({
        secret: 's3cret',
        timestamp: 1700000000000,
        method: 'GET',
        pathAndQuery: '/api/items?q=betoneira',
        body: '',
        operation: 'listar_itens',
        decision: 'executed',
      }),
    ).toBe('v1=0cda2c9edefa8ceb83ee4da7cd5870895a1cea1ddebac27ca2f816a070e69398');
    expect(
      signArsRequest({
        secret: 's3cret',
        timestamp: 1700000000000,
        method: 'POST',
        pathAndQuery: '/api/items',
        body: '{"a":1}',
        operation: 'criar_item',
        decision: 'confirmed',
      }),
    ).toBe('v1=d68695ce27dfe390fbb5c9009bdb3ff0464b3a16269e094939fe4c4c18b528bd');
  });
});

const SECRET = 'sig-secret';

type Over = { timestamp?: number; method?: string; path?: string; body?: string; operation?: string; decision?: 'executed' | 'confirmed' };

function signed(over: Over = {}) {
  const o = { timestamp: Date.now(), method: 'POST', path: '/api/items?q=1', body: '{"a":1}', operation: 'criar_item', decision: 'executed' as const, ...over };
  const headers: Record<string, string> = {
    'X-ARS-Timestamp': String(o.timestamp),
    'X-ARS-Operation': o.operation,
    'X-ARS-Risk': 'validated',
    'X-ARS-Decision': o.decision,
    'X-ARS-Signature': signArsRequest({ secret: SECRET, timestamp: o.timestamp, method: o.method, pathAndQuery: o.path, body: o.body, operation: o.operation, decision: o.decision }),
  };
  return { method: o.method, url: o.path, body: o.body, headers };
}

describe('verifyArsSignature', () => {
  it('round trip verifies absolute and relative urls and header casing', () => {
    const base = signed();
    const expectOk = { ok: true, operation: 'criar_item', risk: 'validated', decision: 'executed' };
    expect(verifyArsSignature(base, SECRET)).toEqual(expectOk);
    expect(verifyArsSignature({ ...base, url: 'http://h/api/items?q=1' }, SECRET)).toEqual(expectOk);
    const lower = Object.fromEntries(Object.entries(base.headers).map(([k, v]) => [k.toLowerCase(), [v]]));
    expect(verifyArsSignature({ ...base, headers: lower }, SECRET)).toEqual(expectOk);
  });

  it('tampering and skew are rejected with distinct reasons', () => {
    const reason = (r: ArsSignedRequest, opts?: { maxSkewMs?: number }) => {
      const v = verifyArsSignature(r, SECRET, opts);
      return v.ok ? 'ok' : v.reason;
    };
    expect(reason(signed({ timestamp: Date.now() - 400_000 }))).toBe('expired');
    expect(reason(signed({ timestamp: Date.now() - 2000 }), { maxSkewMs: 1000 })).toBe('expired');
    expect(reason(signed({ timestamp: Date.now() + 400_000 }))).toBe('expired');
    const base = signed();
    expect(reason({ ...base, body: '{"a":2}' })).toBe('bad_signature');
    expect(reason({ ...base, method: 'PUT' })).toBe('bad_signature');
    expect(reason({ ...base, url: '/api/items?q=2' })).toBe('bad_signature');
    expect(reason({ ...base, headers: { ...base.headers, 'X-ARS-Operation': 'apagar' } })).toBe('bad_signature');
    expect(reason({ ...base, headers: { ...base.headers, 'X-ARS-Decision': 'confirmed' } })).toBe('bad_signature');
    expect(verifyArsSignature(base, 'other')).toEqual({ ok: false, reason: 'bad_signature' });
    const riskChanged = verifyArsSignature({ ...base, headers: { ...base.headers, 'X-ARS-Risk': 'free' } }, SECRET);
    expect(riskChanged).toMatchObject({ ok: true, risk: 'free' });
  });

  it('missing and malformed headers', () => {
    const base = signed();
    for (const name of Object.keys(base.headers)) {
      const rest = { ...base.headers };
      delete rest[name];
      expect(verifyArsSignature({ ...base, headers: rest }, SECRET)).toEqual({ ok: false, reason: 'missing_header' });
    }
    const withHeader = (name: string, value: string) => ({ ...base, headers: { ...base.headers, [name]: value } });
    expect(verifyArsSignature(withHeader('X-ARS-Signature', base.headers['X-ARS-Signature'].slice(3)), SECRET)).toEqual({ ok: false, reason: 'bad_format' });
    expect(verifyArsSignature(withHeader('X-ARS-Signature', 'v1=abcd'), SECRET)).toEqual({ ok: false, reason: 'bad_format' });
    expect(verifyArsSignature(withHeader('X-ARS-Timestamp', 'yesterday'), SECRET)).toEqual({ ok: false, reason: 'bad_format' });
    expect(readFileSync(new URL('./signature.ts', import.meta.url), 'utf8')).toContain('timingSafeEqual');
  });

  it('public exports and no framework imports', () => {
    expect(publicApi.verifyArsSignature).toBe(verifyArsSignature);
    expect(publicApi.signArsRequest).toBe(signArsRequest);
    const source = readFileSync(new URL('./signature.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"](express|http|node:http)['"]/);
  });
});
