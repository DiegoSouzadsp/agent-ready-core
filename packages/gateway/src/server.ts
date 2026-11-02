import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerArsTools, stderrAuditSink } from '@agent-ready/adapter-mcp';
import type { AuditSink, RegisterArsToolsOptions } from '@agent-ready/adapter-mcp';
import type { AdapterResolvers } from '@agent-ready/core';
import { loadPlugin } from './plugin.js';
import { buildExecutorMap } from './executors.js';
import type { LoadedPlugin } from './plugin.js';

export interface CreateGatewayServerOptions {
  pluginDir: string;
  /** Identity forwarded via the plugin's acting_user_header on every executor call. */
  actingUser?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Resolvers that enforce state_guards (keyed by predicate, default 'sql.query'). Without them guards are declared, not enforced. */
  resolvers?: AdapterResolvers;
  /** Audit sink; defaults to JSON lines on stderr. */
  onAudit?: AuditSink;
}

export interface RegisterPluginToolsOptions {
  actingUser?: string;
  /** Resolved on every executor call; takes precedence over actingUser. */
  getActingUser?: () => string | undefined;
  /** Agent profile of the request in flight; signed into X-ARS-Agent and named in a denial. */
  getAgentProfile?: () => string | undefined;
  /** Operator-side ceiling resolved per call; forwarded to the pipeline. */
  autonomy?: RegisterArsToolsOptions['autonomy'];
  fetchImpl?: typeof fetch;
  context?: Record<string, unknown>;
  exposeContract?: boolean;
  resolvers?: AdapterResolvers;
  onAudit?: AuditSink;
}

/**
 * Load a plugin directory and stand up a ready-to-use MCP server for it — the
 * one-call path for a standalone gateway process (one plugin, one server).
 */
export async function createGatewayServer(
  options: CreateGatewayServerOptions,
): Promise<{ server: McpServer; plugin: LoadedPlugin }> {
  const plugin = await loadPlugin(options.pluginDir, options.env ?? process.env);
  const server = new McpServer({ name: `ars-gateway-${plugin.name}`, version: '0.1.0' });

  registerPluginTools(server, plugin, {
    actingUser: options.actingUser,
    fetchImpl: options.fetchImpl,
    resolvers: options.resolvers,
    onAudit: options.onAudit,
  });

  return { server, plugin };
}

/**
 * Register a loaded plugin's operations onto an existing MCP server — the
 * composition path for hosts that manage their own server instance (e.g. one
 * server per HTTP session, with actingUser taken from that session's headers).
 */
export function registerPluginTools(
  server: McpServer,
  plugin: LoadedPlugin,
  opts: RegisterPluginToolsOptions = {},
): void {
  const executors = buildExecutorMap(plugin, {
    fetchImpl: opts.fetchImpl,
    getActingUser: opts.getActingUser ?? (() => opts.actingUser),
    getAgentProfile: opts.getAgentProfile,
  });

  registerArsTools(server, plugin.agent, executors, {
    context: opts.context,
    exposeContract: opts.exposeContract,
    resolvers: opts.resolvers,
    autonomy: opts.autonomy,
    agent: opts.getAgentProfile,
    // why: a gateway runs unattended, so decisions leave a trail unless the host picks another sink.
    onAudit: opts.onAudit ?? stderrAuditSink,
  });
}
