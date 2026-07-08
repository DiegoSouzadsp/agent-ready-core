import { describe, it, expect, vi } from 'vitest';
import { AgentReady } from '@agent-ready/core';
import { renderTemplate, buildExecutor, buildExecutorMap } from './executors.js';
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
