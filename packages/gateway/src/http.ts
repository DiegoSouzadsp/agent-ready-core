import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadPlugin } from './plugin.js';
import { registerPluginTools } from './server.js';
import type { LoadedPlugin } from './plugin.js';
import type { AuditSink } from '@agent-ready/adapter-mcp';
import type { AdapterResolvers } from '@agent-ready/core';

export interface StartGatewayHttpOptions {
  pluginDir: string;
  /** Port to listen on (0 = ephemeral, useful in tests). Default 8808. */
  port?: number;
  host?: string;
  /**
   * INBOUND header carrying the acting user on each MCP request (host → gateway).
   * Independent from the plugin's outbound acting_user_header (gateway → system).
   */
  actingUserHeader?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  resolvers?: AdapterResolvers;
  onAudit?: AuditSink;
}

export interface RunningGateway {
  httpServer: Server;
  plugin: LoadedPlugin;
  port: number;
}

/**
 * why: Streamable HTTP at /mcp keeps sessions, one McpServer per
 * session (so the client's capabilities, e.g. elicitation, survive between calls),
 * while the acting user is read from each request.
 * Identity is therefore per-call — exactly what a multi-user host (one MCP
 * connection, many end users) needs to keep permissions enforced at the source.
 */
export async function startGatewayHttp(options: StartGatewayHttpOptions): Promise<RunningGateway> {
  const plugin = await loadPlugin(options.pluginDir, options.env ?? process.env);
  const inboundHeader = (options.actingUserHeader ?? 'x-acting-user').toLowerCase();

  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();
  const actingUserStore = new AsyncLocalStorage<string | undefined>();

  // why: elicitation needs the client's initialize capabilities at tools/call time, so one McpServer lives per session.
  async function createSession() {
    const server = new McpServer({ name: `ars-gateway-${plugin.name}`, version: '0.1.0' });
    registerPluginTools(server, plugin, {
      getActingUser: () => actingUserStore.getStore(),
      fetchImpl: options.fetchImpl,
      resolvers: options.resolvers,
      onAudit: options.onAudit,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
      void server.close();
    };
    await server.connect(transport);
    return { transport, server };
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? '').split('?')[0];

    if (req.method === 'GET' && url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', plugin: plugin.name, operations: plugin.agent.operations }));
      return;
    }

    if (url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. MCP endpoint is POST /mcp; health check is GET /healthz.' }));
      return;
    }

    try {
      const rawActingUser = req.headers[inboundHeader];
      const actingUser =
        (Array.isArray(rawActingUser) ? rawActingUser[0] : rawActingUser)?.trim() || undefined;
      const rawSession = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(rawSession) ? rawSession[0] : rawSession;

      let session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        if (sessionId || req.method !== 'POST') {
          res.writeHead(sessionId ? 404 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: sessionId ? 'Unknown session.' : 'Missing mcp-session-id header.' }));
          return;
        }
        session = await createSession();
      }

      // why: identity is per call even though the server is per session, so it is read from the request in flight.
      await actingUserStore.run(actingUser, () => session!.transport.handleRequest(req, res));
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Gateway error: ${(err as Error).message}` }));
      }
    }
  });

  const requestedPort = options.port ?? 8808;
  await new Promise<void>((resolve) =>
    httpServer.listen(requestedPort, options.host ?? '0.0.0.0', resolve),
  );
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  return { httpServer, plugin, port };
}
