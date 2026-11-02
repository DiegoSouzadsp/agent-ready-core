import { describe, it, expect, vi } from 'vitest';
import { AgentReady } from '@agent-ready/core';
import { renderTemplate, buildExecutor, buildExecutorMap } from './executors.js';
import { signArsRequest, verifyArsSignature } from './signature.js';
import type { LoadedPlugin, PluginManifest, ExecutorSpec } from './plugin.js';

const MANIFEST: PluginManifest = {
  plugin: 'reference',
  system_base_url: 'https://api.example.com',
  auth: { service_token: 'secret-token' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('renderTemplate', () => {
  it('substitutes {{field}} with String(input[field])', () => {
    expect(renderTemplate('{{a}}-{{b}}', { a: 1, b: 'x' })).toBe('1-x');
  });

  it('renders a missing field as empty string', () => {
    expect(renderTemplate('{{missing}}', {})).toBe('');
  });
});

describe('buildExecutor — URL & query building', () => {
  it('builds the URL with query params encoded, omitting params whose field is absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const spec: ExecutorSpec = {
      method: 'GET',
      path: '/api/items',
      query: { q: '{{busca}}', limit: '{{limite}}' },
    };
    const executor = buildExecutor('listar_itens', spec, MANIFEST, { fetchImpl });

    await executor({ busca: 'caneta azul' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string, unknown];
    expect(url).toBe('https://api.example.com/api/items?q=caneta+azul');
  });

  it('percent-encodes path placeholder values', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const spec: ExecutorSpec = { method: 'GET', path: '/api/items/{{id}}' };
    const executor = buildExecutor('get_item', spec, MANIFEST, { fetchImpl });

    await executor({ id: 'a b/c' });

    const [url] = fetchImpl.mock.calls[0] as [string, unknown];
    expect(url).toBe('https://api.example.com/api/items/a%20b%2Fc');
  });

  it('does not double-slash when path already starts with /', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const manifestTrailingSlash: PluginManifest = { ...MANIFEST, system_base_url: 'https://api.example.com/' };
    const spec: ExecutorSpec = { method: 'GET', path: '/api/items' };
    const executor = buildExecutor('listar_itens', spec, manifestTrailingSlash, { fetchImpl });

    await executor({});

    const [url] = fetchImpl.mock.calls[0] as [string, unknown];
    expect(url).toBe('https://api.example.com/api/items');
  });
});

describe('buildExecutor — body & headers', () => {
  it('sends the full input as JSON body when body_from_input is true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
    const spec: ExecutorSpec = { method: 'POST', path: '/api/items', body_from_input: true };
    const executor = buildExecutor('criar_item', spec, MANIFEST, { fetchImpl });

    await executor({ nome: 'Caneta', valor: 10 });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(JSON.parse(init.body as string)).toEqual({ nome: 'Caneta', valor: 10 });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('renders {{field}} templates recursively inside a static body spec', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const spec: ExecutorSpec = {
      method: 'POST',
      path: '/api/items',
      body: { name: '{{nome}}', nested: { tag: '{{tag}}' } },
    };
    const executor = buildExecutor('criar_item', spec, MANIFEST, { fetchImpl });

    await executor({ nome: 'Caneta', tag: 'office' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Caneta', nested: { tag: 'office' } });
  });

  it('includes Authorization and acting-user headers when configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const spec: ExecutorSpec = { method: 'GET', path: '/api/items' };
    const executor = buildExecutor('listar_itens', spec, MANIFEST, {
      fetchImpl,
      getActingUser: () => 'user-42',
    });

    await executor({});

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['Authorization']).toBe('Bearer secret-token');
    expect(init.headers['X-Acting-User']).toBe('user-42');
  });

  it('omits Authorization and acting-user headers when not configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const noAuthManifest: PluginManifest = { plugin: 'reference', system_base_url: 'https://api.example.com' };
    const spec: ExecutorSpec = { method: 'GET', path: '/api/items' };
    const executor = buildExecutor('listar_itens', spec, noAuthManifest, { fetchImpl });

    await executor({});

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['Authorization']).toBeUndefined();
    expect(init.headers['X-Acting-User']).toBeUndefined();
  });

  it('respects a custom acting_user_header from the manifest', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const customManifest: PluginManifest = {
      ...MANIFEST,
      auth: { ...MANIFEST.auth, acting_user_header: 'X-User-Id' },
    };
    const spec: ExecutorSpec = { method: 'GET', path: '/api/items' };
    const executor = buildExecutor('listar_itens', spec, customManifest, {
      fetchImpl,
      getActingUser: () => 'user-42',
    });

    await executor({});

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['X-User-Id']).toBe('user-42');
    expect(init.headers['X-Acting-User']).toBeUndefined();
  });
});

describe('buildExecutor — response handling', () => {
  it('throws with the operation name on HTTP >= 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('server exploded', { status: 500 }));
    const spec: ExecutorSpec = { method: 'GET', path: '/api/items' };
    const executor = buildExecutor('listar_itens', spec, MANIFEST, { fetchImpl });

    await expect(executor({})).rejects.toThrow(/listar_itens: HTTP 500/);
  });

  it('wraps a JSON array response in { items }', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ id: 1 }, { id: 2 }]));
    const spec: ExecutorSpec = { method: 'GET', path: '/api/items' };
    const executor = buildExecutor('listar_itens', spec, MANIFEST, { fetchImpl });

    const result = await executor({});
    expect(result).toEqual({ items: [{ id: 1 }, { id: 2 }] });
  });

  it('returns a JSON object response directly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1, nome: 'Caneta' }));
    const spec: ExecutorSpec = { method: 'POST', path: '/api/items', body_from_input: true };
    const executor = buildExecutor('criar_item', spec, MANIFEST, { fetchImpl });

    const result = await executor({ nome: 'Caneta' });
    expect(result).toEqual({ id: 1, nome: 'Caneta' });
  });

  it('returns {} for a 204 No Content response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const spec: ExecutorSpec = { method: 'DELETE', path: '/api/items/{{id}}' };
    const executor = buildExecutor('deletar_item', spec, MANIFEST, { fetchImpl });

    const result = await executor({ id: 1 });
    expect(result).toEqual({});
  });

  it('wraps a non-JSON body in { raw }', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('plain text', { status: 200 }));
    const spec: ExecutorSpec = { method: 'GET', path: '/api/items' };
    const executor = buildExecutor('listar_itens', spec, MANIFEST, { fetchImpl });

    const result = await executor({});
    expect(result).toEqual({ raw: 'plain text' });
  });
});

describe('buildExecutorMap', () => {
  it('builds one executor per entry in executorSpecs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const agent = AgentReady.fromYAML(`
schema_version: "0.1"
module: demo
operations: []
`);
    const plugin: LoadedPlugin = {
      name: 'reference',
      dir: '/fake',
      manifest: MANIFEST,
      agent,
      executorSpecs: {
        listar_itens: { method: 'GET', path: '/api/items' },
        criar_item: { method: 'POST', path: '/api/items', body_from_input: true },
      },
    };

    const map = buildExecutorMap(plugin, { fetchImpl });

    expect(Object.keys(map).sort()).toEqual(['criar_item', 'listar_itens']);
    await map.listar_itens({});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('buildExecutor — X-ARS signing', () => {
  const SIGNED: PluginManifest = { ...MANIFEST, auth: { service_token: 'secret-token', signing_secret: 'sig-secret' } };
  const ctx = { decision: 'executed', risk_level: 'free' } as const;
  const sent = (fetchImpl: ReturnType<typeof vi.fn>) =>
    fetchImpl.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body?: string }];
  const expected = (url: string, init: { method: string; headers: Record<string, string>; body?: string }, op: string, risk: string, decision: string) => {
    const u = new URL(url);
    return signArsRequest({
      secret: 'sig-secret',
      timestamp: Number(init.headers['X-ARS-Timestamp']),
      nonce: init.headers['X-ARS-Nonce'],
      method: init.method,
      pathAndQuery: u.pathname + u.search,
      body: init.body ?? '',
      operation: op,
      risk,
      decision,
      actingUser: init.headers['X-Acting-User'] ?? '',
    });
  };

  it('signing_secret adds verifiable X-ARS headers', async () => {
    const cases: Array<[string, ExecutorSpec, Record<string, unknown>]> = [
      ['get_op', { path: '/api/items', query: { q: '{{q}}' } }, { q: 'a b' }],
      ['post_input', { method: 'POST', path: '/api/items', body_from_input: true }, { nome: 'x' }],
      ['post_body', { method: 'POST', path: '/api/items', body: { n: '{{nome}}' } }, { nome: 'y' }],
    ];
    for (const [op, spec, input] of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
      await buildExecutor(op, spec, SIGNED, { fetchImpl })(input, ctx);
      const [url, init] = sent(fetchImpl);
      expect(Math.abs(Date.now() - Number(init.headers['X-ARS-Timestamp']))).toBeLessThan(5000);
      expect(init.headers['X-ARS-Operation']).toBe(op);
      expect(init.headers['X-ARS-Nonce']).toMatch(/^[0-9a-f]{32}$/);
      expect(init.headers['X-ARS-Risk']).toBe('free');
      expect(init.headers['X-ARS-Decision']).toBe('executed');
      expect(init.headers['X-ARS-Signature']).toBe(expected(url, init, op, 'free', 'executed'));
      expect(init.headers['X-ARS-Signature']).toMatch(/^v1=[0-9a-f]{64}$/);
      expect(verifyArsSignature({ method: init.method, url, body: init.body, headers: init.headers }, 'sig-secret')).toMatchObject({ ok: true, operation: op, decision: 'executed' });
    }
  });

  it('X-ARS-Agent is sent and signed', async () => {
    const withProfile = vi.fn().mockResolvedValue(jsonResponse({}));
    await buildExecutor('get_item', { path: '/api/items' }, SIGNED, { fetchImpl: withProfile, getAgentProfile: () => 'bot1' })({}, ctx);
    const [url, init] = sent(withProfile);
    expect(init.headers['X-ARS-Agent']).toBe('bot1');
    expect(verifyArsSignature({ method: 'GET', url, headers: init.headers }, 'sig-secret')).toMatchObject({ ok: true, agent: 'bot1' });

    const noProfile = vi.fn().mockResolvedValue(jsonResponse({}));
    await buildExecutor('get_item', { path: '/api/items' }, SIGNED, { fetchImpl: noProfile })({}, ctx);
    const [url2, init2] = sent(noProfile);
    expect(init2.headers['X-ARS-Agent']).toBe('');
    expect(verifyArsSignature({ method: 'GET', url: url2, headers: init2.headers }, 'sig-secret')).toMatchObject({ ok: true, agent: '' });

    const unsigned = vi.fn().mockResolvedValue(jsonResponse({}));
    await buildExecutor('get_item', { path: '/api/items' }, MANIFEST, { fetchImpl: unsigned, getAgentProfile: () => 'bot1' })({}, ctx);
    const names = Object.keys(sent(unsigned)[1].headers).map((h) => h.toLowerCase());
    expect(names.filter((h) => h.startsWith('x-ars-'))).toEqual([]);
  });

  it('signature covers the encoded path and query that was sent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    await buildExecutor('get_item', { path: '/api/items/{{id}}' }, SIGNED, { fetchImpl })({ id: 'a b/c' }, ctx);
    const [url, init] = sent(fetchImpl);
    expect(url).toContain('a%20b%2Fc');
    expect(init.headers['X-ARS-Signature']).toBe(expected(url, init, 'get_item', 'free', 'executed'));
    expect(verifyArsSignature({ method: 'GET', url, headers: init.headers }, 'sig-secret').ok).toBe(true);
    expect(verifyArsSignature({ method: 'GET', url: url.replace('a%20b%2Fc', 'a b/c'), headers: init.headers }, 'sig-secret').ok).toBe(false);
  });

  it('no X-ARS headers without secret or without context', async () => {
    const cases: Array<[PluginManifest, typeof ctx | undefined]> = [
      [MANIFEST, ctx],
      [{ ...MANIFEST, auth: { service_token: 't', signing_secret: '' } }, ctx],
      [SIGNED, undefined],
    ];
    for (const [manifest, c] of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
      await buildExecutor('op', { path: '/x' }, manifest, { fetchImpl })({}, c);
      const names = Object.keys(sent(fetchImpl)[1].headers).map((h) => h.toLowerCase());
      expect(names.filter((h) => h.startsWith('x-ars-'))).toEqual([]);
    }
  });

  it('confirmed decision is signed and not swappable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    await buildExecutor('del', { method: 'DELETE', path: '/x' }, SIGNED, { fetchImpl })({}, { decision: 'confirmed', risk_level: 'confirmation' });
    const [url, init] = sent(fetchImpl);
    expect(init.headers['X-ARS-Decision']).toBe('confirmed');
    expect(init.headers['X-ARS-Risk']).toBe('confirmation');
    expect(init.headers['X-ARS-Signature']).toBe(expected(url, init, 'del', 'confirmation', 'confirmed'));
    const swapped = { ...init.headers, 'X-ARS-Decision': 'executed' };
    expect(verifyArsSignature({ method: 'DELETE', url, headers: swapped }, 'sig-secret')).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('forged X-ARS headers from spec.headers are replaced by the signed ones', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const spec: ExecutorSpec = {
      method: 'DELETE',
      path: '/x',
      headers: { 'X-ARS-Decision': 'executed', 'x-ars-operation': 'forged', 'X-ARS-Risk': 'free' },
    };
    await buildExecutor('del', spec, SIGNED, { fetchImpl })({}, { decision: 'confirmed', risk_level: 'confirmation' });
    const [url, init] = sent(fetchImpl);
    const names = Object.keys(init.headers).map((h) => h.toLowerCase());
    expect(names.filter((h) => h === 'x-ars-decision')).toHaveLength(1);
    expect(names.filter((h) => h === 'x-ars-operation')).toHaveLength(1);
    expect(init.headers['X-ARS-Decision']).toBe('confirmed');
    expect(init.headers['X-ARS-Operation']).toBe('del');
    expect(init.headers['X-ARS-Risk']).toBe('confirmation');
    expect(verifyArsSignature({ method: 'DELETE', url, headers: init.headers }, 'sig-secret')).toMatchObject({ ok: true, decision: 'confirmed', operation: 'del' });
  });

  it('signs the acting user that was sent and uses a fresh nonce per call', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({}));
    const run = buildExecutor('op', { path: '/x' }, SIGNED, { fetchImpl, getActingUser: () => 'alice' });
    await run({}, ctx);
    await run({}, ctx);
    const [url, init] = sent(fetchImpl);
    expect(verifyArsSignature({ method: 'GET', url, headers: init.headers }, 'sig-secret')).toMatchObject({ ok: true, actingUser: 'alice' });
    expect(verifyArsSignature({ method: 'GET', url, headers: { ...init.headers, 'X-Acting-User': 'mallory' } }, 'sig-secret')).toEqual({ ok: false, reason: 'bad_signature' });
    const nonces = fetchImpl.mock.calls.map((c) => (c[1] as { headers: Record<string, string> }).headers['X-ARS-Nonce']);
    expect(new Set(nonces).size).toBe(2);
  });
});
