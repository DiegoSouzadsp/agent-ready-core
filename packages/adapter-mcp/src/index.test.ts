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
  it('registers one tool per operation, named after operation.name (plus the contract meta-tool)', () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();

    registerArsTools(server as any, agent, {});

    expect(server.registerTool).toHaveBeenCalledTimes(3);
    const registeredNames = server.registerTool.mock.calls.map((call) => call[0]);
    expect(registeredNames.sort()).toEqual(['deletar_gasto', 'get_operation_contract', 'registrar_gasto']);
  });

  it('passes a risk-tagged description and a Zod inputSchema in the tool config', () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();

    registerArsTools(server as any, agent, {});

    const [, config] = server.registerTool.mock.calls.find((call) => call[0] === 'registrar_gasto')!;
    expect(config.description).toBe('[risk: validated] Registra um gasto Required fields: valor.');
    expect(config.inputSchema.valor).toBeDefined();
    expect(config.inputSchema.valor.safeParse(50).success).toBe(true);
  });

  it('flags a risk_level:confirmation operation in both the description and annotations.destructiveHint', () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();

    registerArsTools(server as any, agent, {});

    const [, config] = server.registerTool.mock.calls.find((call) => call[0] === 'deletar_gasto')!;
    expect(config.description).toBe(
      '[risk: confirmation] Deleta um gasto — always requires explicit human confirmation; it executes only after the human approves (client elicitation), otherwise it returns a pending response. Required fields: gasto_id.',
    );
    expect(config.annotations).toEqual({ destructiveHint: true });
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

  it('wires each operation to its own executor by name — valid input invokes only the matching executor, not another operation\'s', async () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();
    const registrarExecutor = vi.fn().mockResolvedValue({ gasto_id: 1 });
    const deletarExecutor = vi.fn().mockResolvedValue({ deleted: true });

    registerArsTools(server as any, agent, {
      registrar_gasto: registrarExecutor,
      deletar_gasto: deletarExecutor,
    });

    const [, , handler] = server.registerTool.mock.calls.find((call) => call[0] === 'registrar_gasto')!;
    const result = await handler({ valor: 50 });

    expect(result.isError).toBe(false);
    expect(registrarExecutor).toHaveBeenCalledTimes(1);
    expect(registrarExecutor).toHaveBeenCalledWith({ valor: 50 }, { decision: 'executed', risk_level: 'validated' });
    expect(deletarExecutor).not.toHaveBeenCalled();
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

const FK_SCHEMA = `
schema_version: "0.1"
module: financeiro
operations:
  - id: OP-03
    name: registrar_gasto_categorizado
    description: Registra um gasto com categoria
    risk_level: validated
    autonomy_policy: execute_after_validation
    input_schema:
      valor:
        type: decimal
        required: true
        gt: 0
      categoria_id:
        type: int
        required: true
        foreign_key:
          table: categorias
`;

describe('registerArsTools — get_operation_contract meta-tool', () => {
  it('registers the meta-tool by default, after the schema operations', () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();

    registerArsTools(server as any, agent, {});

    const registeredNames = server.registerTool.mock.calls.map((call) => call[0]);
    expect(registeredNames).toContain('get_operation_contract');
    expect(server.registerTool).toHaveBeenCalledTimes(3); // 2 ops + meta-tool
  });

  it('does not register the meta-tool when exposeContract is false', () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();

    registerArsTools(server as any, agent, {}, { exposeContract: false });

    const registeredNames = server.registerTool.mock.calls.map((call) => call[0]);
    expect(registeredNames).not.toContain('get_operation_contract');
  });

  it('returns the full operation definition as JSON + structuredContent', async () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();

    registerArsTools(server as any, agent, {});

    const [, , handler] = server.registerTool.mock.calls.find(
      (call) => call[0] === 'get_operation_contract',
    )!;
    const result = await handler({ operation: 'registrar_gasto' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.name).toBe('registrar_gasto');
    expect(result.structuredContent.risk_level).toBe('validated');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.input_schema.valor.gt).toBe(0);
  });

  it('teaches on unknown operation: isError with the list of available operations', async () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();

    registerArsTools(server as any, agent, {});

    const [, , handler] = server.registerTool.mock.calls.find(
      (call) => call[0] === 'get_operation_contract',
    )!;
    const result = await handler({ operation: 'nao_existe' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('registrar_gasto');
    expect(result.content[0].text).toContain('deletar_gasto');
  });
});

describe('registerArsTools — foreign_key validation in the pipeline', () => {
  it('blocks the executor and returns validation_error when the FK row does not exist', async () => {
    const agent = AgentReady.fromYAML(FK_SCHEMA, {
      'entity.exists': () => false,
    });
    const server = mockServer();
    const executor = vi.fn();

    registerArsTools(server as any, agent, { registrar_gasto_categorizado: executor });

    const [, , handler] = server.registerTool.mock.calls.find(
      (call) => call[0] === 'registrar_gasto_categorizado',
    )!;
    const result = await handler({ valor: 50, categoria_id: 999 });

    expect(result.isError).toBe(true);
    expect(executor).not.toHaveBeenCalled();
    expect(result.structuredContent.errors[0].code).toBe('FK_NOT_FOUND');
  });

  it('calls the executor when the FK row exists', async () => {
    const agent = AgentReady.fromYAML(FK_SCHEMA, {
      'entity.exists': () => true,
    });
    const server = mockServer();
    const executor = vi.fn().mockResolvedValue({ gasto_id: 1 });

    registerArsTools(server as any, agent, { registrar_gasto_categorizado: executor });

    const [, , handler] = server.registerTool.mock.calls.find(
      (call) => call[0] === 'registrar_gasto_categorizado',
    )!;
    const result = await handler({ valor: 50, categoria_id: 15 });

    expect(result.isError).toBe(false);
    expect(executor).toHaveBeenCalledWith({ valor: 50, categoria_id: 15 }, { decision: 'executed', risk_level: 'validated' });
  });

  it('keeps pre-FK behavior when no entity.exists resolver is registered', async () => {
    const agent = AgentReady.fromYAML(FK_SCHEMA); // no resolvers
    const server = mockServer();
    const executor = vi.fn().mockResolvedValue({ gasto_id: 1 });

    registerArsTools(server as any, agent, { registrar_gasto_categorizado: executor });

    const [, , handler] = server.registerTool.mock.calls.find(
      (call) => call[0] === 'registrar_gasto_categorizado',
    )!;
    const result = await handler({ valor: 50, categoria_id: 999 });

    expect(result.isError).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
  });
});

describe('registerArsTools - permissive input schema', () => {
  it('permissive input schema lists required fields in description', () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();
    registerArsTools(server as any, agent, {});

    for (const [name, config] of server.registerTool.mock.calls.map((c) => [c[0], c[1]] as const)) {
      if (name === 'get_operation_contract') continue;
      for (const field of Object.values(config.inputSchema) as any[]) {
        expect(field.safeParse(undefined).success).toBe(true);
      }
    }
    const reg = server.registerTool.mock.calls.find((c) => c[0] === 'registrar_gasto')![1];
    expect(reg.description).toContain('Required fields: valor');
  });
});

describe('registerArsTools - state guards', () => {
  const GUARD_SCHEMA = `
schema_version: "0.1"
module: tickets
operations:
  - id: OP-01
    name: fechar_chamado
    description: Fecha um chamado
    risk_level: contextual
    autonomy_policy: execute_after_validation
    input_schema:
      chamado_id:
        type: int
        required: true
    state_guards:
      - description: ticket is open
        query: SELECT status FROM tickets WHERE id = @chamado_id
        assert:
          status: open
        on_fail:
          message: Ticket already closed
`;

  it('declared but unenforced guards are disclosed', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const agent = AgentReady.fromYAML(GUARD_SCHEMA);
      const server = mockServer();
      const executor = vi.fn().mockResolvedValue({});
      registerArsTools(server as any, agent, { fechar_chamado: executor });

      const [, config, handler] = server.registerTool.mock.calls.find((c) => c[0] === 'fechar_chamado')!;
      expect(config.description).toContain('not enforced');
      expect(write.mock.calls.map((c) => String(c[0])).join('')).toContain('fechar_chamado');
      const result = await handler({ chamado_id: 1 });
      expect(result.isError).toBe(false);
      expect(executor).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
    }
  });

  it('enforces guards and stays silent when a sql.query resolver is configured', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const agent = AgentReady.fromYAML(GUARD_SCHEMA);
      const server = mockServer();
      const executor = vi.fn();
      registerArsTools(server as any, agent, { fechar_chamado: executor }, {
        resolvers: { 'sql.query': () => ({ status: 'closed' }) },
      });

      const [, config, handler] = server.registerTool.mock.calls.find((c) => c[0] === 'fechar_chamado')!;
      expect(config.description).not.toContain('not enforced');
      expect(write).not.toHaveBeenCalled();
      const result = await handler({ chamado_id: 1 });
      expect(result.structuredContent.type).toBe('blocked_transition');
      expect(executor).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});

describe('registerArsTools - wrong type is never a protocol error', () => {
  it('every field schema accepts a wrong-typed value so ARS can answer with a signpost', async () => {
    const agent = AgentReady.fromYAML(TWO_OP_SCHEMA);
    const server = mockServer();
    registerArsTools(server as any, agent, { registrar_gasto: vi.fn() });

    const [, config, handler] = server.registerTool.mock.calls.find((c) => c[0] === 'registrar_gasto')!;
    expect(config.inputSchema.valor.safeParse('abc').success).toBe(true);
    expect(config.inputSchema.valor.safeParse(5).success).toBe(true);

    const result = await handler({ valor: 'abc' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.type).toBe('validation_error');
    expect(result.content[0].text).toContain('[valor]');
  });
});

describe('registerArsTools - guards through the agent adapter', () => {
  const SCHEMA = `
schema_version: "0.1"
module: tickets
operations:
  - id: OP-01
    name: fechar_chamado
    risk_level: contextual
    autonomy_policy: execute_after_validation
    input_schema:
      chamado_id:
        type: int
        required: true
    state_guards:
      - description: ticket is open
        query: SELECT status FROM tickets WHERE id = @chamado_id
        assert:
          status: open
        on_fail:
          message: Ticket already closed
`;

  it('evaluates and discloses guards by the effective adapter, without options.resolvers', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const sqlQuery = vi.fn().mockResolvedValue({ status: 'closed' });
      const agent = AgentReady.fromYAML(SCHEMA, { 'sql.query': sqlQuery });
      const server = mockServer();
      const executor = vi.fn();
      registerArsTools(server as any, agent, { fechar_chamado: executor });

      const [, config, handler] = server.registerTool.mock.calls.find((c) => c[0] === 'fechar_chamado')!;
      expect(config.description).not.toContain('not enforced');
      expect(write).not.toHaveBeenCalled();
      const result = await handler({ chamado_id: 1 });
      expect(sqlQuery).toHaveBeenCalledTimes(1);
      expect(result.structuredContent.type).toBe('blocked_transition');
      expect(executor).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});
