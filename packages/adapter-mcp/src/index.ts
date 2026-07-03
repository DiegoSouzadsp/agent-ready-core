import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentReady } from '@agent-ready/core';
import { operationInputSchema } from './schema.js';
import { runOperation } from './pipeline.js';
import type { ExecutorMap } from './types.js';

export type { ExecutorFn, ExecutorMap, McpToolResult } from './types.js';
export { inputFieldsToZodShape, operationInputSchema } from './schema.js';
export { runOperation } from './pipeline.js';

export interface RegisterArsToolsOptions {
  /** Static context passed to applyDefaults()/validate() for infer_from_context fields (e.g. a fixed membro_id for a single-tenant bridge). */
  context?: Record<string, unknown>;
}

/**
 * Register one MCP tool per operation in an ARS schema. Calling a tool runs the
 * full governance pipeline (defaults -> validate -> confirmation gate -> executor
 * -> signpost) instead of only describing the operation — see design.md.
 *
 * Operations with no matching entry in `executors` are still registered (so
 * `list_tools()` reflects the whole schema), but calling them returns an error
 * result explaining no executor is configured (MCP-06).
 */
export function registerArsTools(
  server: McpServer,
  agent: AgentReady,
  executors: ExecutorMap,
  options: RegisterArsToolsOptions = {},
): void {
  for (const opDef of agent.allOperations) {
    const inputSchema = operationInputSchema(opDef);

    const handler = async (input: Record<string, unknown>) =>
      runOperation(agent.operation(opDef.name), executors[opDef.name], input, options.context ?? {});

    // The SDK's `registerTool` infers the handler's arg type from `inputSchema` via
    // `ShapeOutput<Args>`, which recurses excessively (TS2589) for a non-literal
    // `Record<string, ZodTypeAny>` shape built at runtime (field set varies per
    // operation, unknown at compile time) — this is a TS instantiation-depth limit,
    // not a real type error. ARS's own validateInput() is the authoritative validator
    // regardless of the SDK's inferred arg type, so bypassing generic inference here
    // is safe — see design.md's Zod Tech Decision.
    (server.registerTool as (name: string, config: unknown, cb: unknown) => unknown)(
      opDef.name,
      { description: opDef.description, inputSchema },
      handler,
    );
  }
}
