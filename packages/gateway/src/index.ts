/**
 * @agent-ready/gateway
 *
 * Generic ARS gateway engine — serves any system's operations as MCP tools
 * from a declarative plugin directory (ARS schemas + HTTP executor mapping),
 * with no per-system code.
 */

export * from './plugin.js';
export * from './executors.js';
export * from './server.js';
