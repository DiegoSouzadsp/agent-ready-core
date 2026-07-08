import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerArsTools } from '@agent-ready/adapter-mcp';
import { loadPlugin } from './plugin.js';
import { buildExecutorMap } from './executors.js';
import type { LoadedPlugin } from './plugin.js';

export interface CreateGatewayServerOptions {
  pluginDir: string;
  /** Identity forwarded via the plugin's acting_user_header on every executor call. */
  actingUser?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export interface RegisterPluginToolsOptions {
  actingUser?: string;
  fetchImpl?: typeof fetch;
  context?: Record<string, unknown>;
  exposeContract?: boolean;
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
    getActingUser: () => opts.actingUser,
  });

  registerArsTools(server, plugin.agent, executors, {
    context: opts.context,
    exposeContract: opts.exposeContract,
  });
}
