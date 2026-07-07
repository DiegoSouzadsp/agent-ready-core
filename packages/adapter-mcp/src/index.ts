import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentReady } from '@agent-ready/core';
import { operationInputSchema, operationToolDescription, operationToolAnnotations } from './schema.js';
import { runOperation } from './pipeline.js';
import type { ExecutorMap, McpToolResult } from './types.js';

export type { ExecutorFn, ExecutorMap, McpToolResult } from './types.js';
export {
  fieldConstraintSummary,
  inputFieldsToZodShape,
  operationInputSchema,
  operationToolDescription,
  operationToolAnnotations,
} from './schema.js';
export { runOperation } from './pipeline.js';

/** Name of the meta-tool that returns an operation's full ARS contract. */
export const CONTRACT_TOOL_NAME = 'get_operation_contract';

export interface RegisterArsToolsOptions {
  /** Static context passed to applyDefaults()/validate() for infer_from_context fields (e.g. a fixed membro_id for a single-tenant bridge). */
  context?: Record<string, unknown>;
  /**
   * Expose the get_operation_contract meta-tool (default true), which returns
   * the full ARS definition of one operation — the complete "bula" the agent
   * can pull before composing inputs for a complex call.
   */
  exposeContract?: boolean;
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
    const description = operationToolDescription(opDef);
    const annotations = operationToolAnnotations(opDef);

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
      { description, inputSchema, annotations },
      handler,
    );
  }

  // Skipped when the schema has no operations (nothing to describe) or when it
  // defines an operation with this name — the schema's operation wins over the
  // meta-tool (no double registration).
  if (
    options.exposeContract !== false &&
    agent.allOperations.length > 0 &&
    !agent.has(CONTRACT_TOOL_NAME)
  ) {
    registerContractTool(server, agent);
  }
}

/**
 * Register the get_operation_contract meta-tool: returns the full ARS
 * definition (fields with rules, defaults, foreign keys, risk level,
 * validations, state guards, signposts) of one operation as JSON. The MCP
 * inputSchema exposes only type/description/enum per field; this tool is how
 * an agent pulls the complete contract before composing a complex call.
 */
function registerContractTool(server: McpServer, agent: AgentReady): void {
  const handler = async ({ operation }: { operation: string }): Promise<McpToolResult> => {
    const found = agent.find(operation);
    if (!found) {
      return {
        content: [
          {
            type: 'text',
            text: `Operation "${operation}" not found. Available operations: ${agent.operations.join(', ')}`,
          },
        ],
        isError: true,
      };
    }
    const definition = found.definition;
    return {
      content: [{ type: 'text', text: JSON.stringify(definition, null, 2) }],
      structuredContent: definition as unknown as Record<string, unknown>,
      isError: false,
    };
  };

  (server.registerTool as (name: string, config: unknown, cb: unknown) => unknown)(
    CONTRACT_TOOL_NAME,
    {
      description:
        '[risk: free] Returns the full Agent-Ready Schema contract for one operation: every input field with its type, rules, defaults and foreign keys, plus risk level, validation rules, state guards and signposts. Call this BEFORE composing inputs for a complex or high-risk operation.',
      inputSchema: {
        operation: z
          .string()
          .describe('Operation name or id (e.g. "registrar_gasto" or "OP-FIN-01")'),
      },
      annotations: { readOnlyHint: true },
    },
    handler,
  );
}
