/**
 * Minimal runnable example: exposes the FamilyOS financeiro.yml schema as MCP
 * tools over stdio, using in-memory stub executors. Run with:
 *
 *   npx tsx packages/adapter-mcp/examples/familyos-stdio-server.ts
 *
 * Point an MCP client (e.g. Claude Desktop's config) at this script to see
 * ARS governance (risk levels, validation, confirmation gating, signposts)
 * applied to real MCP tool calls.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentReady } from '@agent-ready/core';
import { registerArsTools } from '../src/index.js';
import type { ExecutorMap } from '../src/index.js';

const SCHEMA_PATH = new URL(
  '../../../docs/schemas/familyos/financeiro.yml',
  import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, '$1'); // strip leading slash on Windows drive paths

// Stub executors — stand-ins for FamilyOS's real DB/API calls. deletar_gasto and
// fechar_mes are risk_level:confirmation, so the bridge never actually invokes
// their executor (AD-002) — they're wired anyway for schema completeness.
const executors: ExecutorMap = {
  registrar_gasto: (input) => ({ gasto_id: 1, categoria: 'mercado', envelope_percentual: 42, ...input }),
  registrar_gasto_ocr: (input) => ({ gasto_id: 2, ocr_confidence: 0.95, ...input }),
  registrar_entrada: (input) => ({ entrada_id: 1, ...input }),
  consulta_mes: () => ({ total_gastos: 0, gastos: [] }),
  atualizar_gasto: (input) => ({ gasto_id: input.gasto_id, updated: true }),
  deletar_gasto: (input) => ({ gasto_id: input.gasto_id, deleted: true }),
  fechar_mes: () => ({ fechado: true }),
  aporte_meta: (input) => ({ meta_id: input.meta_id, novo_saldo: 0 }),
};

async function main() {
  const agent = await AgentReady.fromFile(SCHEMA_PATH);

  const server = new McpServer({ name: 'agent-ready-familyos-mcp-server', version: '0.1.0' });
  registerArsTools(server, agent, executors);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[agent-ready/adapter-mcp] serving ${agent.operations.length} operations over stdio`);
}

main().catch((err) => {
  console.error('[agent-ready/adapter-mcp] server error:', err);
  process.exit(1);
});
