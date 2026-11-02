import type { RiskLevel } from '@agent-ready/core';

/**
 * Pipeline facts handed to the executor as its optional second argument.
 * why: `confirmed` only exists after an elicitation accept, so the executor cannot infer it from the spec.
 */
export type ExecutorContext = { decision: 'executed' | 'confirmed'; risk_level: RiskLevel };

/**
 * A host-supplied function that performs the real action for one ARS operation.
 * Receives the validated (post-defaults) input; returns the result data used to build the success signpost.
 */
export type ExecutorFn = (
  input: Record<string, unknown>,
  ctx?: ExecutorContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

/** Map of ARS operation name → its executor. Operations with no entry return an error when called. */
export type ExecutorMap = Record<string, ExecutorFn>;

/**
 * MCP tool call result shape (per @modelcontextprotocol/sdk's CallToolResult contract).
 * `inputSchema` on `registerTool` is a raw Zod shape (`Record<string, AnySchema>` /
 * `ZodRawShapeCompat`), confirmed against the installed SDK's `dist/esm/server/mcp.d.ts` —
 * not a wrapped `z.object(...)`.
 */
export interface McpToolResult {
  content: [{ type: 'text'; text: string }];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
