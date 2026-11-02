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

  it('GET /healthz reports only status', async () => {
    const res = await fetch(`http://127.0.0.1:${gateway.port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
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

describe('startGatewayHttp — exposure without inbound auth', () => {
  const ENV = { REFERENCE_API_URL: 'http://fake-system.local', REFERENCE_TOKEN: 'svc-secret' };
  const close = (g: RunningGateway) => new Promise<void>((r) => g.httpServer.close(() => r()));

  it('listens on loopback by default', async () => {
    const g = await startGatewayHttp({ pluginDir: REFERENCE_DIR, port: 0, env: ENV });
    try {
      const address = g.httpServer.address();
      expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
    } finally {
      await close(g);
    }
  });

  it('refuses a non-loopback host without tokens unless explicitly allowed', async () => {
    await expect(startGatewayHttp({ pluginDir: REFERENCE_DIR, port: 0, host: '0.0.0.0', env: ENV })).rejects.toThrow(/inbound auth off/);
    const open = await startGatewayHttp({ pluginDir: REFERENCE_DIR, port: 0, host: '0.0.0.0', env: ENV, allowInsecureNoAuth: true });
    await close(open);
    const guarded = await startGatewayHttp({ pluginDir: REFERENCE_DIR, port: 0, host: '0.0.0.0', env: ENV, inboundTokens: ['t'] });
    await close(guarded);
  });
});

describe('startGatewayHttp - agent profile configuration', () => {
  const ENV = { REFERENCE_API_URL: 'http://fake-system.local', REFERENCE_TOKEN: 'svc-secret' };
  const policy = (name: string) => ({
    agent_policy: '1.0' as const,
    name,
    autonomy: { execute_up_to: 'validated' as const, ask_up_to: 'contextual' as const },
  });

  it('unknown or duplicate profile fails before listening', async () => {
    await expect(
      startGatewayHttp({
        pluginDir: REFERENCE_DIR,
        port: 0,
        env: ENV,
        inboundTokens: ['tok-a'],
        tokenProfiles: { 'tok-a': 'ghost' },
        agentPolicies: [policy('other')],
      }),
    ).rejects.toThrow(/"ghost"/);
    await expect(
      startGatewayHttp({
        pluginDir: REFERENCE_DIR,
        port: 0,
        env: ENV,
        inboundTokens: ['tok-a'],
        agentPolicies: [policy('twin'), policy('twin')],
      }),
    ).rejects.toThrow(/"twin"/);
  });
});

describe('startGatewayHttp - agent profiles end to end', () => {
  const policyOf = (execute: string, ask: string, name: string) => ({
    agent_policy: '1.0' as const,
    name,
    autonomy: { execute_up_to: execute as 'free', ask_up_to: ask as 'free' },
  });
  let dir: string;
  const gateways: RunningGateway[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ars-prof-'));
    await mkdir(join(dir, 'schemas'));
    await writeFile(
      join(dir, 'plugin.yml'),
      'plugin: prof\nsystem_base_url: http://fake-system.local\nauth:\n  signing_secret: sig-secret\n',
    );
    await writeFile(
      join(dir, 'schemas', 's.yml'),
      [
        'schema_version: "0.1"',
        'module: prof',
        'operations:',
        '  - id: P-01',
        '    name: registrar_item',
        '    description: Registra',
        '    risk_level: validated',
        '    input_schema:',
        '      nome: { type: string, required: true }',
        '  - id: P-02',
        '    name: remover_item',
        '    description: Remove',
        '    risk_level: confirmation',
        '    input_schema:',
        '      id: { type: int, required: true }',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(dir, 'executors.yml'),
      'registrar_item:\n  method: POST\n  path: /api/items\n  body_from_input: true\nremover_item:\n  method: DELETE\n  path: "/api/items/{{id}}"\n',
    );
  });

  afterAll(async () => {
    for (const g of gateways) await new Promise<void>((r) => g.httpServer.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  });

  async function boot(withPolicies = true) {
    const fetchMock = vi.fn(async () => new Response('{"id":1}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const events: Array<{ decision: string; risk_level: string; operation: string }> = [];
    const gateway = await startGatewayHttp({
      pluginDir: dir,
      port: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
      inboundTokens: ['tok-a', 'tok-b', 'tok-c', 'tok-n'],
      agentPolicies: withPolicies
        ? [policyOf('contextual', 'confirmation', 'permissive'), policyOf('free', 'free', 'strict'), policyOf('free', 'contextual', 'asker')]
        : [],
      tokenProfiles: withPolicies ? { 'tok-a': 'permissive', 'tok-b': 'strict', 'tok-c': 'asker' } : {},
      onAudit: (e) => events.push(e),
    });
    gateways.push(gateway);
    const connect = async (token: string, elicit?: { action: string; content?: Record<string, unknown> }) => {
      const client = new Client({ name: 'prof', version: '0' }, elicit ? { capabilities: { elicitation: {} } } : undefined);
      if (elicit) client.setRequestHandler(ElicitRequestSchema, (async () => elicit) as never);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${gateway.port}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      return client;
    };
    return { gateway, fetchMock, events, connect };
  }
  const type = (r: unknown) => (r as { structuredContent?: { type?: string } }).structuredContent?.type;

  it('same tools call executes for one profile and is denied for the other', async () => {
    const { fetchMock, events, connect } = await boot();
    const a = await connect('tok-a');
    const ra = await a.callTool({ name: 'registrar_item', arguments: { nome: 'x' } });
    expect(type(ra)).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const b = await connect('tok-b');
    const rb = await b.callTool({ name: 'registrar_item', arguments: { nome: 'x' } });
    expect(type(rb)).toBe('denied');
    expect((rb.structuredContent as { reason: string }).reason).toBe('agent policy strict does not allow registrar_item (validated)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await a.close();
    await b.close();
    expect(events.map((e) => e.decision)).toEqual(['executed', 'denied']);
  });

  it('denied call emits one denied audit event', async () => {
    const { events, connect } = await boot();
    const b = await connect('tok-b');
    await b.callTool({ name: 'registrar_item', arguments: { nome: 'x' } });
    await b.close();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ decision: 'denied', risk_level: 'validated' });
  });

  it('token without profile keeps current behaviour', async () => {
    const { fetchMock, connect } = await boot();
    const n = await connect('tok-n');
    expect(type(await n.callTool({ name: 'registrar_item', arguments: { nome: 'x' } }))).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(type(await n.callTool({ name: 'remover_item', arguments: { id: 3 } }))).toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await n.close();
  });

  it('profile follows the request bearer not the session', async () => {
    const { gateway, connect } = await boot();
    const a = await connect('tok-a');
    const sessionId = (a.transport as StreamableHTTPClientTransport).sessionId!;
    const call = (token: string, id: number) =>
      fetch(`http://127.0.0.1:${gateway.port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'registrar_item', arguments: { nome: 'x' } } }),
      }).then((r) => r.text());
    expect(await call('tok-b', 10)).toContain('"type":"denied"');
    expect(await call('tok-a', 11)).toContain('"type":"success"');
    await a.close();
  });

  it('profile ask goes through elicitation or pending', async () => {
    const accepted = await boot();
    const c1 = await accepted.connect('tok-c', { action: 'accept', content: { confirm: true } });
    expect(type(await c1.callTool({ name: 'registrar_item', arguments: { nome: 'x' } }))).toBe('success');
    expect(accepted.fetchMock).toHaveBeenCalledTimes(1);
    const sentInit = (accepted.fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(sentInit.headers['X-ARS-Decision']).toBe('confirmed');
    await c1.close();

    const declined = await boot();
    const c2 = await declined.connect('tok-c', { action: 'decline' });
    await c2.callTool({ name: 'registrar_item', arguments: { nome: 'x' } });
    expect(declined.fetchMock).not.toHaveBeenCalled();
    expect(declined.events[0].decision).toBe('declined');
    await c2.close();

    const none = await boot();
    const c3 = await none.connect('tok-c');
    expect(type(await c3.callTool({ name: 'registrar_item', arguments: { nome: 'x' } }))).toBe('pending');
    expect(none.fetchMock).not.toHaveBeenCalled();
    await c3.close();
  });

  it('end to end X-ARS-Agent carries the token profile', async () => {
    const { fetchMock, connect } = await boot();
    const a = await connect('tok-a');
    await a.callTool({ name: 'registrar_item', arguments: { nome: 'x' } });
    const n = await connect('tok-n');
    await n.callTool({ name: 'registrar_item', arguments: { nome: 'x' } });
    await a.close();
    await n.close();
    const sent = fetchMock.mock.calls.map((c) => c as unknown as [string, { method: string; headers: Record<string, string>; body?: string }]);
    const [urlA, initA] = sent[0];
    expect(initA.headers['X-ARS-Agent']).toBe('permissive');
    expect(verifyArsSignature({ method: initA.method, url: urlA, body: initA.body, headers: initA.headers }, 'sig-secret')).toMatchObject({ ok: true, agent: 'permissive' });
    const [urlN, initN] = sent[1];
    expect(initN.headers['X-ARS-Agent']).toBe('');
    expect(verifyArsSignature({ method: initN.method, url: urlN, body: initN.body, headers: initN.headers }, 'sig-secret')).toMatchObject({ ok: true, agent: '' });
  });

  it('tool list is identical for every profile', async () => {
    const withPolicies = await boot();
    const list = async (c: Client) => (await c.listTools()).tools.map((t) => `${t.name}|${t.description}`);
    const a = await withPolicies.connect('tok-a');
    const b = await withPolicies.connect('tok-b');
    const la = await list(a);
    expect(await list(b)).toEqual(la);
    await a.close();
    await b.close();
    const plain = await boot(false);
    const n = await plain.connect('tok-n');
    expect(await list(n)).toEqual(la);
    await n.close();
  });
});
