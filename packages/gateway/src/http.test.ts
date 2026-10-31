import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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

  it('missing required field is a signpost not -32602', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'criar_item', arguments: { valor: 'abc' } });
    const text = (result.content as Array<{ text: string }>)[0].text;

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { type?: string }).type).toBe('validation_error');
    expect(text).toContain('Reason:');
    expect(text).toContain('What to do:');
    expect(text).toContain('[nome]');
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

describe('startGatewayHttp — real client elicitation', () => {
  async function run(answer: { action: string; content?: Record<string, unknown> }) {
    const fetchMock = vi.fn(async () =>
      new Response('{"id":7}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const gateway = await startGatewayHttp({
      pluginDir: REFERENCE_DIR,
      port: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
      env: { REFERENCE_API_URL: 'http://fake-system.local', REFERENCE_TOKEN: 'svc-secret' },
      onAudit: () => {},
    });
    const client = new Client({ name: 'elicit-client', version: '0.0.1' }, { capabilities: { elicitation: {} } });
    const asked = vi.fn(async () => answer);
    client.setRequestHandler(ElicitRequestSchema, asked as never);
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${gateway.port}/mcp`)));
    const result = await client.callTool({ name: 'criar_item', arguments: { nome: 'Andaime', valor: 120 } });
    await client.close();
    await new Promise<void>((r) => gateway.httpServer.close(() => r()));
    return { result, fetchMock, asked };
  }

  it('real client elicitation accept executes decline does not', async () => {
    const accepted = await run({ action: 'accept', content: { confirm: true } });
    expect(accepted.asked).toHaveBeenCalledTimes(1);
    expect(accepted.fetchMock).toHaveBeenCalledTimes(1);
    expect((accepted.result.structuredContent as { type?: string }).type).toBe('success');

    const declined = await run({ action: 'decline' });
    expect(declined.fetchMock).not.toHaveBeenCalled();
    expect((declined.result.structuredContent as { type?: string }).type).toBe('pending');
  });
});

describe('startGatewayHttp — state guards and audit', () => {
  let dir: string;
  const gateways: RunningGateway[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ars-guard-plugin-'));
    await mkdir(join(dir, 'schemas'));
    await writeFile(
      join(dir, 'plugin.yml'),
      'plugin: guarded\nsystem_base_url: http://fake-system.local\nauth:\n  mode: service_token_acting_user\n  service_token: tok\n',
    );
    await writeFile(
      join(dir, 'schemas', 'g.yml'),
      [
        'schema_version: "0.1"',
        'module: g',
        'operations:',
        '  - id: G-01',
        '    name: close_ticket',
        '    description: Close a ticket',
        '    risk_level: contextual',
        '    autonomy_policy: execute_immediately',
        '    input_schema:',
        '      ticket_id:',
        '        type: string',
        '        required: true',
        '    state_guards:',
        '      - description: ticket must be open',
        '        query: "SELECT status FROM tickets WHERE id = :ticket_id"',
        '        assert:',
        '          status: open',
        '        on_fail:',
        '          message: Ticket is not open',
        '          suggest: Reopen it first',
        '',
      ].join('\n'),
    );
    await writeFile(join(dir, 'executors.yml'), 'close_ticket:\n  method: POST\n  path: /tickets/close\n  body_from_input: true\n');
  });

  afterAll(async () => {
    for (const g of gateways) await new Promise<void>((r) => g.httpServer.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  });

  async function start(extra: Partial<Parameters<typeof startGatewayHttp>[0]>) {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const gateway = await startGatewayHttp({
      pluginDir: dir,
      port: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
      env: {},
      onAudit: () => {},
      ...extra,
    });
    gateways.push(gateway);
    const client = new Client({ name: 'guard-test-client', version: '0.0.1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${gateway.port}/mcp`)));
    return { client, fetchMock };
  }

  it('without resolvers the guard is not enforced: the call executes and the description says so', async () => {
    const { client, fetchMock } = await start({});
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === 'close_ticket')?.description).toMatch(/not enforced/);
    const result = await client.callTool({ name: 'close_ticket', arguments: { ticket_id: 'T-1' } });
    expect(result.isError ?? false).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it('with a resolver whose result violates the assert, returns blocked_transition and never calls the executor', async () => {
    const resolver = vi.fn(async () => [{ status: 'closed' }]);
    const { client, fetchMock } = await start({ resolvers: { 'sql.query': resolver } });
    const result = await client.callTool({ name: 'close_ticket', arguments: { ticket_id: 'T-1' } });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((result.structuredContent as { type?: string }).type).toBe('blocked_transition');
    await client.close();
  });

  it('delivers one audit event per call to the injected sink', async () => {
    const events: Array<{ operation: string; decision: string }> = [];
    const { client } = await start({
      resolvers: { 'sql.query': async () => [{ status: 'open' }] },
      onAudit: (e) => events.push(e),
    });
    await client.callTool({ name: 'close_ticket', arguments: { ticket_id: 'T-1' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operation: 'close_ticket', decision: 'executed' });
    await client.close();
  });
});
