import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startGatewayHttp } from './http.js';
import { verifyArsSignature } from './signature.js';
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

describe('startGatewayHttp — inbound auth', () => {
  const ENV = { REFERENCE_API_URL: 'http://fake-system.local', REFERENCE_TOKEN: 'svc-secret' };
  let gateway: RunningGateway;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    fetchMock = vi.fn(async () =>
      new Response('{"items":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    gateway = await startGatewayHttp({
      pluginDir: REFERENCE_DIR,
      port: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
      env: ENV,
      inboundTokens: ['tok-a', 'tok-b'],
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => gateway.httpServer.close(() => resolve()));
  });

  const mcpUrl = () => `http://127.0.0.1:${gateway.port}/mcp`;
  const initializeBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
  });
  const post = (headers: Record<string, string>) =>
    fetch(mcpUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: initializeBody,
    });

  it('inbound auth rejects missing or wrong bearer with 401', async () => {
    for (const headers of [{}, { Authorization: 'Bearer nope' }, { Authorization: 'Basic tok-a' }, { Authorization: 'Bearer ' }]) {
      const res = await post(headers);
      expect(res.status).toBe(401);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('unauthorized request creates no session and cannot reuse one', async () => {
    const bad = await post({ Authorization: 'Bearer nope' });
    expect(bad.headers.get('mcp-session-id')).toBeNull();

    const ok = await post({ Authorization: 'Bearer tok-a' });
    expect(ok.status).toBe(200);
    const sessionId = ok.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    const reuse = await fetch(mcpUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(reuse.status).toBe(401);
  });

  it('valid inbound token serves a full session', async () => {
    const client = new Client({ name: 'auth-client', version: '0.0.1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl()), {
        requestInit: { headers: { Authorization: 'Bearer tok-b' } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('listar_itens');
    const result = await client.callTool({ name: 'listar_itens', arguments: {} });
    expect(result.isError ?? false).toBe(false);
    await client.close();
  });

  it('healthz stays public with inbound auth on', async () => {
    const res = await fetch(`http://127.0.0.1:${gateway.port}/healthz`);
    expect(res.status).toBe(200);
  });

  it('acting user is only honored after inbound auth', async () => {
    fetchMock.mockClear();
    const denied = await post({ 'X-Acting-User': 'mallory' });
    expect(denied.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    const client = new Client({ name: 'auth-client', version: '0.0.1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl()), {
        requestInit: { headers: { Authorization: 'Bearer tok-a', 'X-Acting-User': 'alice' } },
      }),
    );
    await client.callTool({ name: 'listar_itens', arguments: {} });
    await client.close();
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Acting-User']).toBe('alice');
  });

  it('no inbound tokens warns once and leaves tool descriptions unchanged', async () => {
    const descriptions = async (g: RunningGateway, headers: Record<string, string>) => {
      const client = new Client({ name: 'desc-client', version: '0.0.1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${g.port}/mcp`), { requestInit: { headers } }),
      );
      const { tools } = await client.listTools();
      await client.close();
      return tools.map((t) => [t.name, t.description]);
    };
    const withTokens = await descriptions(gateway, { Authorization: 'Bearer tok-a' });

    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const open: RunningGateway[] = [];
    try {
      for (const inboundTokens of [undefined, []] as const) {
        stderr.mockClear();
        const g = await startGatewayHttp({ pluginDir: REFERENCE_DIR, port: 0, env: ENV, inboundTokens: inboundTokens as string[] | undefined });
        open.push(g);
        const warned = stderr.mock.calls.filter((c) => String(c[0]).includes('inbound auth disabled; X-Acting-User is trusted'));
        expect(warned).toHaveLength(1);
        expect(await descriptions(g, {})).toEqual(withTokens);
      }
    } finally {
      stderr.mockRestore();
      for (const g of open) await new Promise<void>((r) => g.httpServer.close(() => r()));
    }
  });
});

describe('startGatewayHttp — signed outbound requests', () => {
  it('end to end signed requests carry executed and confirmed decisions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ars-signed-'));
    await cp(REFERENCE_DIR, dir, { recursive: true });
    await writeFile(
      join(dir, 'plugin.yml'),
      'plugin: reference\nsystem_base_url: ${REFERENCE_API_URL}\nauth:\n  service_token: ${REFERENCE_TOKEN}\n  signing_secret: e2e-secret\n',
    );
    const fetchMock = vi.fn(async () =>
      new Response('{"id":1}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const gateway = await startGatewayHttp({
      pluginDir: dir,
      port: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
      env: { REFERENCE_API_URL: 'http://fake-system.local', REFERENCE_TOKEN: 'svc-secret' },
      onAudit: () => {},
    });
    const client = new Client({ name: 'sign-client', version: '0.0.1' }, { capabilities: { elicitation: {} } });
    client.setRequestHandler(ElicitRequestSchema, (async () => ({ action: 'accept', content: { confirm: true } })) as never);
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${gateway.port}/mcp`)));
    try {
      await client.callTool({ name: 'listar_itens', arguments: {} });
      await client.callTool({ name: 'criar_item', arguments: { nome: 'Andaime', valor: 120 } });
      const calls = fetchMock.mock.calls as unknown as Array<[string, { method: string; headers: Record<string, string>; body?: string }]>;
      expect(calls).toHaveLength(2);
      const [free, confirmed] = calls;
      expect(free[1].headers['X-ARS-Decision']).toBe('executed');
      expect(free[1].headers['X-ARS-Risk']).toBe('free');
      expect(confirmed[1].headers['X-ARS-Decision']).toBe('confirmed');
      for (const [url, init] of calls) {
        expect(verifyArsSignature({ method: init.method, url, body: init.body, headers: init.headers }, 'e2e-secret').ok).toBe(true);
      }
    } finally {
      await client.close();
      await new Promise<void>((r) => gateway.httpServer.close(() => r()));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
