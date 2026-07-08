import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadPlugin } from './plugin.js';
import { registerPluginTools } from './server.js';
import type { LoadedPlugin } from './plugin.js';

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
}

export interface RunningGateway {
  httpServer: Server;
  plugin: LoadedPlugin;
  port: number;
}

/**
 * Serve a plugin over Streamable HTTP at POST /mcp, STATELESS: each request gets
 * an ephemeral McpServer whose executors are bound to that request's acting user.
 * Identity is therefore per-call — exactly what a multi-user host (one MCP
 * connection, many end users) needs to keep permissions enforced at the source.
 */
export async function startGatewayHttp(options: StartGatewayHttpOptions): Promise<RunningGateway> {
  const plugin = await loadPlugin(options.pluginDir, options.env ?? process.env);
  const inboundHeader = (options.actingUserHeader ?? 'x-acting-user').toLowerCase();

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

      const server = new McpServer({ name: `ars-gateway-${plugin.name}`, version: '0.1.0' });
      registerPluginTools(server, plugin, { actingUser, fetchImpl: options.fetchImpl });

      // sessionIdGenerator: undefined → stateless mode (no session bookkeeping).
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
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
