import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadPlugin } from './plugin.js';
import { registerPluginTools } from './server.js';
import type { LoadedPlugin } from './plugin.js';
import type { AuditSink } from '@agent-ready/adapter-mcp';
import type { AdapterResolvers, AgentPolicy } from '@agent-ready/core';
import { assertUniquePolicyNames } from './agent-policies.js';

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
  /**
   * Bearer tokens the host must present on /mcp (host → gateway). Empty or absent disables
   * inbound auth and X-Acting-User is trusted as sent. Distinct from the plugin's service_token (gateway → system).
   */
  inboundTokens?: string[];
  /** Agent policies loaded by the host, added to the plugin's own `policies/`. Names must be unique across both. */
  agentPolicies?: AgentPolicy[];
  /** Inbound token -> agent profile name. Every profile must have a loaded policy or the start fails. */
  tokenProfiles?: Record<string, string>;
  /** Permit listening beyond loopback with inbound auth off. Default false: the start fails instead. */
  allowInsecureNoAuth?: boolean;
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host);
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
  const host = options.host ?? '127.0.0.1';
  // hazard: a profile that cannot be resolved must stop the start; running it as "no profile" would widen the agent's autonomy.
  const agentPolicies = [...plugin.agentPolicies, ...(options.agentPolicies ?? [])];
  assertUniquePolicyNames(agentPolicies);
  const tokenProfiles = options.tokenProfiles ?? {};
  for (const profile of new Set(Object.values(tokenProfiles))) {
    if (!agentPolicies.some((policy) => policy.name === profile)) {
      throw new Error(`[gateway] Token mapped to agent profile "${profile}" but no agent policy with that name is loaded (--agent-policy or policies/).`);
    }
  }
  const inboundTokens = [...new Set([...(options.inboundTokens ?? []), ...Object.keys(tokenProfiles)])];
  const hasTokens = inboundTokens.some((token) => token !== '');
  if (!hasTokens && !options.allowInsecureNoAuth && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to listen on "${host}" with inbound auth off: pass inboundTokens (--token / ARS_GATEWAY_TOKENS), bind to 127.0.0.1, or opt in with allowInsecureNoAuth (--insecure-no-auth).`,
    );
  }
  const inboundHeader = (options.actingUserHeader ?? 'x-acting-user').toLowerCase();

  const tokenDigests = inboundTokens
    .filter((token) => token !== '')
    .map((token) => ({ digest: createHash('sha256').update(token).digest(), profile: tokenProfiles[token] }));
  if (tokenDigests.length === 0) {
    console.error('[ars-gateway] warning: inbound auth disabled; X-Acting-User is trusted');
  }

  // invariant: digests have equal length, so timingSafeEqual never throws and token length does not leak.
  // why: the profile is resolved from the Bearer on every request, never remembered on the session.
  function authorize(header: string | string[] | undefined): { profile: string } | null {
    const value = Array.isArray(header) ? header[0] : header;
    const match = /^Bearer (.+)$/.exec(value ?? '');
    if (!match) return null;
    const candidate = createHash('sha256').update(match[1]).digest();
    let found: { profile: string } | null = null;
    for (const entry of tokenDigests) {
      if (timingSafeEqual(entry.digest, candidate)) found = { profile: entry.profile ?? '' };
    }
    return found;
  }

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
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. MCP endpoint is POST /mcp; health check is GET /healthz.' }));
      return;
    }

    // why: auth runs before the acting user is read, a session is created or handleRequest is reached.
    const authorized = tokenDigests.length > 0 ? authorize(req.headers.authorization) : null;
    if (tokenDigests.length > 0 && !authorized) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
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
    httpServer.listen(requestedPort, host, resolve),
  );
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  return { httpServer, plugin, port };
}
