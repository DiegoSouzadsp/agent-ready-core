import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPlugin } from './plugin.js';
import { registerPluginTools } from './server.js';

const REFERENCE_DIR = fileURLToPath(new URL('../plugins/_reference', import.meta.url));
const FAKE_ENV = {
  REFERENCE_API_URL: 'https://api.example.com',
  REFERENCE_TOKEN: 'secret-token',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockServer() {
  return { registerTool: vi.fn() };
}

describe('registerPluginTools', () => {
  it('registers one tool per operation plus the get_operation_contract meta-tool', async () => {
    const plugin = await loadPlugin(REFERENCE_DIR, FAKE_ENV);
    const server = mockServer();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));

    registerPluginTools(server as any, plugin, { fetchImpl });

    const registeredNames = server.registerTool.mock.calls.map((call) => call[0]);
    expect(registeredNames.sort()).toEqual(['criar_item', 'get_operation_contract', 'listar_itens']);
  });

  it('listar_itens (risk: free) with valid input invokes fetch and returns isError: false', async () => {
    const plugin = await loadPlugin(REFERENCE_DIR, FAKE_ENV);
    const server = mockServer();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ id: 1 }]));

    registerPluginTools(server as any, plugin, { fetchImpl });

    const [, , handler] = server.registerTool.mock.calls.find((call) => call[0] === 'listar_itens')!;
    const result = await handler({ busca: 'caneta' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(false);
  });

  it('criar_item (risk: confirmation) never invokes fetch — returns a pending signpost instead', async () => {
    const plugin = await loadPlugin(REFERENCE_DIR, FAKE_ENV);
    const server = mockServer();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));

    registerPluginTools(server as any, plugin, { fetchImpl });

    const [, , handler] = server.registerTool.mock.calls.find((call) => call[0] === 'criar_item')!;
    const result = await handler({ nome: 'Caneta', valor: 10 });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.structuredContent.type).toBe('pending');
  });

  it('forwards the acting user configured on registerPluginTools to the executor call', async () => {
    const plugin = await loadPlugin(REFERENCE_DIR, FAKE_ENV);
    const server = mockServer();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));

    registerPluginTools(server as any, plugin, { fetchImpl, actingUser: 'user-42' });

    const [, , handler] = server.registerTool.mock.calls.find((call) => call[0] === 'listar_itens')!;
    await handler({});

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['X-Acting-User']).toBe('user-42');
  });
});
