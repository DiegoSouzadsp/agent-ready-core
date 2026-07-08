import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startGatewayHttp } from './http.js';
import type { RunningGateway } from './http.js';

const REFERENCE_DIR = fileURLToPath(new URL('../plugins/_reference', import.meta.url));

describe('startGatewayHttp — end-to-end over Streamable HTTP', () => {
  let gateway: RunningGateway;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [{ id: 1, nome: 'Betoneira 400L' }], total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    gateway = await startGatewayHttp({
      pluginDir: REFERENCE_DIR,
      port: 0, // ephemeral
      fetchImpl: fetchMock as unknown as typeof fetch,
      env: { REFERENCE_API_URL: 'http://fake-system.local', REFERENCE_TOKEN: 'svc-secret' },
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => gateway.httpServer.close(() => resolve()));
  });

  async function connectClient(headers: Record<string, string> = {}): Promise<Client> {
    const client = new Client({ name: 'e2e-test-client', version: '0.0.1' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${gateway.port}/mcp`),
      { requestInit: { headers } },
    );
    await client.connect(transport);
    return client;
  }

  it('GET /healthz reports plugin name and operations', async () => {
    const res = await fetch(`http://127.0.0.1:${gateway.port}/healthz`);
    const body = (await res.json()) as { plugin: string; operations: string[] };
    expect(res.status).toBe(200);
    expect(body.plugin).toBe('reference');
    expect(body.operations).toContain('listar_itens');
  });

  it('lists the plugin operations plus get_operation_contract as MCP tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['criar_item', 'get_operation_contract', 'listar_itens']);
    await client.close();
  });

  it('calls a free operation end-to-end, forwarding acting user and service token to the target system', async () => {
    const client = await connectClient({ 'X-Acting-User': 'user-42' });
    const result = await client.callTool({ name: 'listar_itens', arguments: { busca: 'betoneira' } });

    expect(result.isError ?? false).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://fake-system.local/api/items?q=betoneira');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer svc-secret');
    expect(headers['X-Acting-User']).toBe('user-42');
    await client.close();
  });

  it('never reaches the target system for a confirmation operation (pending signpost instead)', async () => {
    fetchMock.mockClear();
    const client = await connectClient({ 'X-Acting-User': 'user-42' });
    const result = await client.callTool({ name: 'criar_item', arguments: { nome: 'Andaime', valor: 120 } });

    expect(result.isError ?? false).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    const structured = result.structuredContent as { type?: string } | undefined;
    expect(structured?.type).toBe('pending');
    await client.close();
  });
});
