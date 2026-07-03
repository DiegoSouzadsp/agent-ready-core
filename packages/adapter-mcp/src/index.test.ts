import { describe, it, expect, vi } from 'vitest';
import { AgentReady } from '@agent-ready/core';
import { registerArsTools } from './index.js';

const TWO_OP_SCHEMA = `
schema_version: "0.1"
module: financeiro
operations:
  - id: OP-01
    name: registrar_gasto
    description: Registra um gasto
    risk_level: validated
    autonomy_policy: execute_after_validation
    input_schema:
      valor:
        type: decimal
        required: true
        gt: 0
  - id: OP-02
    name: deletar_gasto
    description: Deleta um gasto
    risk_level: confirmation
    autonomy_policy: require_explicit_confirmation
    input_schema:
      gasto_id:
        type: int
        required: true
`;

const ZERO_OP_SCHEMA = `
schema_version: "0.1"
module: vazio
operations: []
`;

function mockServer() {
  return { registerTool: vi.fn() };
}

describe('registerArsTools', () => {
  it('registers one tool per operation, named after operation.name', () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();

    registerArsTools(server as any, agent, {});

    expect(server.registerTool).toHaveBeenCalledTimes(2);
    const registeredNames = server.registerTool.mock.calls.map((call) => call[0]);
    expect(registeredNames.sort()).toEqual(['deletar_gasto', 'registrar_gasto']);
  });

  it('passes the operation description and a Zod inputSchema in the tool config', () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();

    registerArsTools(server as any, agent, {});

    const [, config] = server.registerTool.mock.calls.find((call) => call[0] === 'registrar_gasto')!;
    expect(config.description).toBe('Registra um gasto');
    expect(config.inputSchema.valor).toBeDefined();
    expect(config.inputSchema.valor.safeParse(50).success).toBe(true);
  });

  it('registers zero tools for a schema with zero operations, without throwing', () => {
    const agent = AgentReady.fromYAML(ZERO_OP_SCHEMA);
    const server = mockServer();

    expect(() => registerArsTools(server as any, agent, {})).not.toThrow();
    expect(server.registerTool).not.toHaveBeenCalled();
  });

  it('the registered handler delegates to the governance pipeline (invalid input -> isError, executor not called)', async () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();
    const executor = vi.fn();

    registerArsTools(server as any, agent, { registrar_gasto: executor });

    const [, , handler] = server.registerTool.mock.calls.find((call) => call[0] === 'registrar_gasto')!;
    const result = await handler({}); // missing required "valor"

    expect(result.isError).toBe(true);
    expect(executor).not.toHaveBeenCalled();
  });

  it('the registered handler for a risk_level:confirmation operation never invokes its executor', async () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();
    const executor = vi.fn().mockResolvedValue({ ok: true });

    registerArsTools(server as any, agent, { deletar_gasto: executor });

    const [, , handler] = server.registerTool.mock.calls.find((call) => call[0] === 'deletar_gasto')!;
    const result = await handler({ gasto_id: 7 });

    expect(executor).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
  });
});
