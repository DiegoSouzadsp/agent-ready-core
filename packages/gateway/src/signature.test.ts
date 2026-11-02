import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { signArsRequest, verifyArsSignature } from './signature.js';
import type { ArsSignedRequest } from './signature.js';
import * as publicApi from './index.js';

const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('signArsRequest', () => {
  it('known-answer vectors fix the v1 format', () => {
    expect(
      signArsRequest({
        secret: 's3cret',
        timestamp: 1700000000000,
        nonce: NONCE,
        method: 'GET',
        pathAndQuery: '/api/items?q=betoneira',
        body: '',
        operation: 'listar_itens',
        risk: 'free',
        decision: 'executed',
      }),
    ).toBe('v1=a72a5bb61e97c808fbfd899e3aef0cd90d7d7832aaedd5a83455bb264d29a022');
    expect(
      signArsRequest({
        secret: 's3cret',
        timestamp: 1700000000000,
        nonce: NONCE,
        method: 'POST',
        pathAndQuery: '/api/items',
        body: '{"a":1}',
        operation: 'criar_item',
        risk: 'confirmation',
        decision: 'confirmed',
        actingUser: 'alice',
        agent: 'support-bot',
      }),
    ).toBe('v1=575d68d893a6f1c809cb3f32527026267f37daaf0f9c427938578de0b42f4672');
  });
});

const SECRET = 'sig-secret';

type Over = {
  timestamp?: number;
  method?: string;
  path?: string;
  body?: string;
  operation?: string;
  risk?: string;
  decision?: 'executed' | 'confirmed';
  actingUser?: string;
  agent?: string;
};

function signed(over: Over = {}) {
  const o = {
    timestamp: Date.now(),
    method: 'POST',
    path: '/api/items?q=1',
    body: '{"a":1}',
    operation: 'criar_item',
    risk: 'validated',
    decision: 'executed' as const,
    actingUser: '',
    agent: '',
    ...over,
  };
  const headers: Record<string, string> = {
    'X-ARS-Timestamp': String(o.timestamp),
    'X-ARS-Nonce': NONCE,
    'X-ARS-Operation': o.operation,
    'X-ARS-Risk': o.risk,
    'X-ARS-Decision': o.decision,
    'X-ARS-Agent': o.agent,
    'X-ARS-Signature': signArsRequest({
      secret: SECRET,
      timestamp: o.timestamp,
      nonce: NONCE,
      method: o.method,
      pathAndQuery: o.path,
      body: o.body,
      operation: o.operation,
      risk: o.risk,
      decision: o.decision,
      actingUser: o.actingUser,
      agent: o.agent,
    }),
  };
  if (o.actingUser) headers['X-Acting-User'] = o.actingUser;
  return { method: o.method, url: o.path, body: o.body, headers } as ArsSignedRequest & { headers: Record<string, string> };
}

describe('verifyArsSignature', () => {
  it('agent is signed and tampering or removal is rejected', () => {
    const base = signed({ agent: 'bot1' });
    expect(verifyArsSignature(base, SECRET)).toMatchObject({ ok: true, agent: 'bot1' });
    expect(verifyArsSignature({ ...base, headers: { ...base.headers, 'X-ARS-Agent': 'bot2' } }, SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
    const removed = { ...base.headers };
    delete removed['X-ARS-Agent'];
    expect(verifyArsSignature({ ...base, headers: removed }, SECRET)).toEqual({ ok: false, reason: 'bad_signature' });

    const empty = signed();
    const without = { ...empty.headers };
    delete without['X-ARS-Agent'];
    expect(verifyArsSignature(empty, SECRET)).toMatchObject({ ok: true, agent: '' });
    expect(verifyArsSignature({ ...empty, headers: without }, SECRET)).toMatchObject({ ok: true, agent: '' });
  });

  it('round trip verifies absolute and relative urls and header casing', () => {
    const base = signed({ actingUser: 'alice' });
    const expectOk = { ok: true, operation: 'criar_item', risk: 'validated', decision: 'executed', nonce: NONCE, actingUser: 'alice', agent: '' };
    expect(verifyArsSignature(base, SECRET)).toEqual(expectOk);
    expect(verifyArsSignature({ ...base, url: 'http://h/api/items?q=1' }, SECRET)).toEqual(expectOk);
    const lower = Object.fromEntries(Object.entries(base.headers).map(([k, v]) => [k.toLowerCase(), [v]]));
    expect(verifyArsSignature({ ...base, headers: lower }, SECRET)).toEqual(expectOk);
  });

  it('honors a custom acting user header name', () => {
    const base = signed({ actingUser: 'alice' });
    const headers = { ...base.headers, 'X-Who': base.headers['X-Acting-User'] };
    delete headers['X-Acting-User'];
    expect(verifyArsSignature({ ...base, headers }, SECRET, { actingUserHeader: 'X-Who' })).toMatchObject({ ok: true, actingUser: 'alice' });
  });

  it('tampering and skew are rejected with distinct reasons', () => {
    const reason = (r: ArsSignedRequest, opts?: { maxSkewMs?: number }) => {
      const v = verifyArsSignature(r, SECRET, opts);
      return v.ok ? 'ok' : v.reason;
    };
    expect(reason(signed({ timestamp: Date.now() - 200_000 }))).toBe('expired');
    expect(reason(signed({ timestamp: Date.now() - 2000 }), { maxSkewMs: 1000 })).toBe('expired');
    expect(reason(signed({ timestamp: Date.now() + 200_000 }))).toBe('expired');
    expect(reason(signed({ timestamp: Date.now() - 100_000 }))).toBe('ok');
    const base = signed({ actingUser: 'alice' });
    const h = (name: string, value: string) => ({ ...base, headers: { ...base.headers, [name]: value } });
    expect(reason({ ...base, body: '{"a":2}' })).toBe('bad_signature');
    expect(reason({ ...base, method: 'PUT' })).toBe('bad_signature');
    expect(reason({ ...base, url: '/api/items?q=2' })).toBe('bad_signature');
    expect(reason(h('X-ARS-Operation', 'apagar'))).toBe('bad_signature');
    expect(reason(h('X-ARS-Decision', 'confirmed'))).toBe('bad_signature');
    expect(reason(h('X-ARS-Risk', 'free'))).toBe('bad_signature');
    expect(reason(h('X-Acting-User', 'mallory'))).toBe('bad_signature');
    expect(reason(h('X-ARS-Nonce', 'ffffffffffffffffffffffffffffffff'))).toBe('bad_signature');
    expect(verifyArsSignature(base, 'other')).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('a missing acting user header is not interchangeable with an empty one signed for someone', () => {
    const base = signed({ actingUser: 'alice' });
    const headers = { ...base.headers };
    delete headers['X-Acting-User'];
    expect(verifyArsSignature({ ...base, headers }, SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('body undefined, null and non-string count as empty so a GET verifies', () => {
    const get = signed({ method: 'GET', path: '/api/items?q=1', body: '' });
    for (const body of [undefined, null, {}, '']) {
      expect(verifyArsSignature({ ...get, body }, SECRET)).toMatchObject({ ok: true });
    }
    const { body: _omitted, ...withoutBody } = get;
    expect(verifyArsSignature(withoutBody, SECRET)).toMatchObject({ ok: true });
  });

  it('missing and malformed headers', () => {
    const base = signed();
    // why: X-ARS-Agent may be absent (it counts as empty); the signature decides.
    for (const name of Object.keys(base.headers).filter((n) => n !== 'X-ARS-Agent')) {
      const rest = { ...base.headers };
      delete rest[name];
      expect(verifyArsSignature({ ...base, headers: rest }, SECRET)).toEqual({ ok: false, reason: 'missing_header' });
    }
    const nonceless = { ...base.headers };
    delete nonceless['X-ARS-Nonce'];
    expect(verifyArsSignature({ ...base, headers: nonceless }, SECRET)).toEqual({ ok: false, reason: 'missing_header' });
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
