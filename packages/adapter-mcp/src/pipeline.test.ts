import { describe, it, expect, vi } from 'vitest';
import { OperationHandle, noopAdapter, createAdapter } from '@agent-ready/core';
import type { Operation } from '@agent-ready/core';
import { runOperation } from './pipeline.js';
import type { AuditEvent } from './pipeline.js';

const validatedOp = new OperationHandle(
  {
    id: 'OP-TEST-01',
    name: 'registrar_gasto_test',
    risk_level: 'validated',
    autonomy_policy: 'execute_after_validation',
    input_schema: {
      valor: { type: 'decimal', required: true, gt: 0, human_confirmation_if: { gt: 500 } },
      origem: { type: 'string', required: false, default: 'mcp' },
    },
  } satisfies Operation,
  noopAdapter(),
);

const confirmationOp = new OperationHandle(
  {
    id: 'OP-TEST-02',
    name: 'deletar_gasto_test',
    risk_level: 'confirmation',
    autonomy_policy: 'require_explicit_confirmation',
    input_schema: {
      gasto_id: { type: 'int', required: true },
    },
  } satisfies Operation,
  noopAdapter(),
);

describe('runOperation', () => {
  it('returns isError:true with validation_error signpost and never calls the executor when input is invalid', async () => {
    const executor = vi.fn();
    const result = await runOperation(validatedOp, executor, {}); // missing required "valor"

    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).type).toBe('validation_error');
    expect((result.structuredContent as any).errors[0].field).toBe('valor');
    expect(result.content[0].text).toContain((result.structuredContent as any).guidance);
    expect(result.content[0].text.length).toBeGreaterThan(0);
    expect(executor).not.toHaveBeenCalled();
  });

  it('calls the executor with defaulted input and returns a success signpost when valid and no confirmation is needed', async () => {
    const executor = vi.fn().mockResolvedValue({ gasto_id: 42 });
    const result = await runOperation(validatedOp, executor, { valor: 50 });

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith({ valor: 50, origem: 'mcp' });
    expect(result.isError).toBe(false);
    expect((result.structuredContent as any).type).toBe('success');
    expect((result.structuredContent as any).data).toEqual({ gasto_id: 42 });
  });

  it('never calls the executor for a risk_level:confirmation operation, regardless of input', async () => {
    const executor = vi.fn();
    const result = await runOperation(confirmationOp, executor, { gasto_id: 7 });

    expect(executor).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect((result.structuredContent as any).type).toBe('pending');
  });

  it('never calls the executor when a field-level human_confirmation_if trigger fires on a non-confirmation-risk operation', async () => {
    const executor = vi.fn();
    const result = await runOperation(validatedOp, executor, { valor: 600 }); // > 500 threshold

    expect(executor).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect((result.structuredContent as any).type).toBe('pending');
  });

  it('returns isError:true naming the operation when no executor is configured for a valid call', async () => {
    const result = await runOperation(validatedOp, undefined, { valor: 50 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('registrar_gasto_test');
    expect(result.content[0].text.toLowerCase()).toContain('no executor');
  });

  it('catches an executor rejection and returns isError:true without throwing', async () => {
    const executor = vi.fn().mockRejectedValue(new Error('db connection lost'));

    await expect(runOperation(validatedOp, executor, { valor: 50 })).resolves.toMatchObject({
      isError: true,
    });
    const result = await runOperation(validatedOp, executor, { valor: 50 });
    expect(result.content[0].text).toContain('db connection lost');
  });

  it('catches a synchronously-thrown executor error without throwing', async () => {
    const executor = vi.fn().mockImplementation(() => {
      throw new Error('sync boom');
    });

    const result = await runOperation(validatedOp, executor, { valor: 50 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('sync boom');
  });
});

describe('runOperation - signposts that teach', () => {
  const inferOp = new OperationHandle(
    {
      id: 'OP-T-03',
      name: 'abrir_chamado',
      risk_level: 'validated',
      autonomy_policy: 'execute_after_validation',
      input_schema: {
        titulo: { type: 'string', required: true },
        membro_id: { type: 'int', required: true, infer_from_context: true },
      },
      signpost: { success: { next_actions: [{ operation: 'listar_chamados', reason: 'See the queue' }] } },
    } satisfies Operation,
    noopAdapter(),
  );

  it('missing required field returns validation_error with reason and what_to_do', async () => {
    const executor = vi.fn();
    const result = await runOperation(inferOp, executor, { membro_id: 1 });

    expect(result.isError).toBe(true);
    const sp = result.structuredContent as any;
    expect(sp.type).toBe('validation_error');
    expect(sp.reason).toBeTruthy();
    expect(sp.what_to_do).toContain('titulo');
    expect(executor).not.toHaveBeenCalled();
  });

  it('infer_from_context filled before validation', async () => {
    const executor = vi.fn().mockResolvedValue({ id: 9 });
    const result = await runOperation(inferOp, executor, { titulo: 'x' }, { membro_id: 7 });

    expect(result.isError).toBe(false);
    expect(executor).toHaveBeenCalledWith({ titulo: 'x', membro_id: 7 });
  });

  it('success text carries result json and next', async () => {
    const result = await runOperation(inferOp, vi.fn().mockResolvedValue({ id: 9 }), { titulo: 'x' }, { membro_id: 7 });

    const text = result.content[0].text;
    expect(text).toContain('{"id":9}');
    expect(text).toContain('listar_chamados');
    expect(text.indexOf('{"id":9}')).toBeLessThan(text.indexOf('listar_chamados'));
    expect((result.structuredContent as any).data).toEqual({ id: 9 });
  });

  const listOp = (summary_fields?: string[]) =>
    new OperationHandle(
      {
        id: 'OP-T-04',
        name: 'listar_chamados',
        risk_level: 'free',
        input_schema: {},
        response_strategy: { mode: 'summary', detail_operation: 'ver_chamado', summary_fields },
      } satisfies Operation,
      noopAdapter(),
    );

  it('response_strategy summary returns only summary_fields', async () => {
    const full = { id: 1, titulo: 't', corpo: 'long body', historico: [1, 2] };
    const result = await runOperation(listOp(['id', 'titulo']), vi.fn().mockResolvedValue(full), {});
    const sp = result.structuredContent as any;

    expect(sp.data).toEqual({ id: 1, titulo: 't' });
    expect(sp.next.map((n: any) => n.operation)).toContain('ver_chamado');
    expect(result.content[0].text).not.toContain('long body');

    const whole = await runOperation(listOp(undefined), vi.fn().mockResolvedValue(full), {});
    expect((whole.structuredContent as any).data).toEqual(full);
  });
});

describe('runOperation - state guards', () => {
  const guardedOp = (predicate?: string) =>
    new OperationHandle(
      {
        id: 'OP-G-01',
        name: 'fechar_chamado',
        risk_level: 'contextual',
        autonomy_policy: 'execute_after_validation',
        input_schema: { chamado_id: { type: 'int', required: true } },
        state_guards: [
          {
            description: 'ticket is open',
            predicate,
            query: 'SELECT status FROM tickets WHERE id = @chamado_id',
            assert: { status: 'open' },
            on_fail: { message: 'Ticket already closed', suggest: 'Reopen it first' },
          },
        ],
      } satisfies Operation,
      noopAdapter(),
    );

  it('failing state guard blocks and skips executor', async () => {
    const executor = vi.fn();
    const resolver = vi.fn().mockResolvedValue({ status: 'closed' });
    const result = await runOperation(guardedOp(), executor, { chamado_id: 1 }, {}, { resolvers: { 'sql.query': resolver } });

    const sp = result.structuredContent as any;
    expect(sp.type).toBe('blocked_transition');
    expect(sp.reason).toBe('Ticket already closed');
    expect(sp.what_to_do).toBe('Reopen it first');
    expect(executor).not.toHaveBeenCalled();
    expect(resolver).toHaveBeenCalledWith({
      chamado_id: 1,
      query: 'SELECT status FROM tickets WHERE id = @chamado_id',
    });
  });

  it('guards run after fk and before executor', async () => {
    const order: string[] = [];
    const adapter = createAdapter({
      'entity.exists': () => {
        order.push('fk');
        return true;
      },
    });
    const op = new OperationHandle(
      {
        ...guardedOp('ticket.is_open').definition,
        input_schema: { chamado_id: { type: 'int', required: true, foreign_key: { table: 'tickets' } } },
      },
      adapter,
    );
    const executor = vi.fn().mockImplementation(async () => {
      order.push('executor');
      return {};
    });
    const resolvers = {
      'ticket.is_open': () => {
        order.push('guard');
        return [{ status: 'open', extra: 1 }];
      },
    };
    const result = await runOperation(op, executor, { chamado_id: 1 }, {}, { resolvers });

    expect(result.isError).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['fk', 'guard', 'executor']);
  });

  it('does not block when no resolver matches the guard predicate', async () => {
    const executor = vi.fn().mockResolvedValue({});
    const result = await runOperation(guardedOp('other.pred'), executor, { chamado_id: 1 }, {}, { resolvers: { 'sql.query': () => ({ status: 'closed' }) } });

    expect(result.isError).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the guard resolver throws', async () => {
    const executor = vi.fn();
    const resolvers = { 'sql.query': () => { throw new Error('db down'); } };
    const result = await runOperation(guardedOp(), executor, { chamado_id: 1 }, {}, { resolvers });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('db down');
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('runOperation - confirmation through elicitation', () => {
  const fakeServer = (elicitation: unknown, elicitInput: any) => ({
    server: { getClientCapabilities: () => (elicitation ? { elicitation } : {}), elicitInput },
  });

  const confirmOp = new OperationHandle(
    {
      id: 'OP-E-01',
      name: 'apagar_chamado',
      risk_level: 'confirmation',
      input_schema: { chamado_id: { type: 'int', required: true } },
      human_confirmation: { message_template: 'Delete ticket {{chamado_id}}?' },
    } satisfies Operation,
    noopAdapter(),
  );

  it('elicitation advertised calls elicitInput with rendered template', async () => {
    const elicitInput = vi.fn().mockResolvedValue({ action: 'accept', content: { confirm: true } });
    await runOperation(confirmOp, vi.fn().mockResolvedValue({}), { chamado_id: 5 }, {}, { server: fakeServer({}, elicitInput) });

    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(elicitInput).toHaveBeenCalledWith({
      message: 'Delete ticket 5?',
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean' } },
        required: ['confirm'],
      },
    });
  });

  it('elicitation accept true executes', async () => {
    const executor = vi.fn().mockResolvedValue({ deleted: true });
    const elicitInput = vi.fn().mockResolvedValue({ action: 'accept', content: { confirm: true } });
    const result = await runOperation(confirmOp, executor, { chamado_id: 5 }, {}, { server: fakeServer({}, elicitInput) });

    expect(executor).toHaveBeenCalledTimes(1);
    expect((result.structuredContent as any).type).toBe('success');
  });

  it('elicitation decline cancel false do not execute', async () => {
    for (const answer of [
      { action: 'decline' },
      { action: 'cancel' },
      { action: 'accept', content: { confirm: false } },
    ]) {
      const executor = vi.fn();
      const result = await runOperation(
        confirmOp,
        executor,
        { chamado_id: 5 },
        {},
        { server: fakeServer({}, vi.fn().mockResolvedValue(answer)) },
      );
      expect(executor).not.toHaveBeenCalled();
      expect((result.structuredContent as any).type).toBe('pending');
      expect(result.content[0].text).toContain('declined');
    }
  });

  it('no elicitation capability falls back to pending', async () => {
    const elicitInput = vi.fn();
    const executor = vi.fn();
    for (const server of [fakeServer(undefined, elicitInput), {}, undefined]) {
      const result = await runOperation(confirmOp, executor, { chamado_id: 5 }, {}, { server });
      expect((result.structuredContent as any).type).toBe('pending');
      expect(result.content[0].text).toContain('Delete ticket 5?');
    }
    expect(elicitInput).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it('elicitation failure fails closed to pending', async () => {
    const executor = vi.fn();
    const elicitInput = vi.fn().mockRejectedValue(new Error('timeout'));
    const result = await runOperation(confirmOp, executor, { chamado_id: 5 }, {}, { server: fakeServer({}, elicitInput) });

    expect((result.structuredContent as any).type).toBe('pending');
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('runOperation - audit', () => {
  const auditedOp = new OperationHandle(
    {
      id: 'OP-A-01',
      name: 'registrar_gasto_audit',
      risk_level: 'confirmation',
      input_schema: { valor: { type: 'decimal', required: true }, nota: { type: 'string', required: false } },
      audit: { log: true, include_fields: ['valor'] },
      state_guards: [
        { description: 'g', query: 'SELECT 1', assert: { ok: true }, on_fail: { message: 'no' } },
      ],
    } satisfies Operation,
    noopAdapter(),
  );
  const plainOp = new OperationHandle(
    {
      id: 'OP-A-02',
      name: 'ler_audit',
      risk_level: 'free',
      input_schema: { x: { type: 'int', required: false } },
    } satisfies Operation,
    noopAdapter(),
  );
  const elicit = (answer: any) => ({
    server: {
      getClientCapabilities: () => ({ elicitation: {} }),
      elicitInput: vi.fn().mockResolvedValue(answer),
    },
  });
  const accept = { action: 'accept', content: { confirm: true } };

  it('emits exactly one audit event per decision', async () => {
    const run = async (op: OperationHandle, exec: any, input: any, opts: any = {}) => {
      const events: AuditEvent[] = [];
      await runOperation(op, exec, input, {}, { ...opts, onAudit: (e: AuditEvent) => events.push(e) });
      return events;
    };
    const ok = vi.fn().mockResolvedValue({});
    const table: Array<[string, AuditEvent[]]> = [
      ['executed', await run(plainOp, ok, { x: 1 })],
      ['validation_error', await run(auditedOp, ok, {})],
      [
        'blocked',
        await run(auditedOp, ok, { valor: 1 }, { resolvers: { 'sql.query': () => ({ ok: false }) } }),
      ],
      ['pending', await run(auditedOp, ok, { valor: 1 })],
      ['confirmed', await run(auditedOp, ok, { valor: 1 }, { server: elicit(accept) })],
      ['declined', await run(auditedOp, ok, { valor: 1 }, { server: elicit({ action: "decline" }) })],
      ['error', await run(plainOp, vi.fn().mockRejectedValue(new Error('x')), { x: 1 })],
    ];

    for (const [decision, events] of table) {
      expect(events, decision).toHaveLength(1);
      expect(events[0].decision).toBe(decision);
      expect(typeof events[0].ts).toBe('string');
      expect(events[0].duration_ms).toBeGreaterThanOrEqual(0);
    }
    expect(table[0][1][0]).toMatchObject({ operation: 'ler_audit', risk_level: 'free', input_keys: ['x'] });
  });

  it('audit_fields follow include_fields', async () => {
    const events: AuditEvent[] = [];
    const onAudit = (e: AuditEvent) => events.push(e);
    await runOperation(auditedOp, vi.fn(), { valor: 9, nota: 'secret' }, {}, { onAudit });
    await runOperation(plainOp, vi.fn().mockResolvedValue({}), { x: 1 }, {}, { onAudit });

    expect(events[0].audit_fields).toEqual({ valor: 9 });
    expect(events[0].input_keys).toEqual(['valor', 'nota']);
    expect(events[1].audit_fields).toEqual({});
  });

  it('no audit sink writes nothing', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const prev = process.env.ARS_AUDIT;
    delete process.env.ARS_AUDIT;
    try {
      await runOperation(plainOp, vi.fn().mockResolvedValue({}), { x: 1 });
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
      if (prev !== undefined) process.env.ARS_AUDIT = prev;
    }
  });

  it('ARS_AUDIT=stderr emits jsonl', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const prev = process.env.ARS_AUDIT;
    process.env.ARS_AUDIT = 'stderr';
    try {
      await runOperation(plainOp, vi.fn().mockResolvedValue({}), { x: 1 });
      expect(write).toHaveBeenCalledTimes(1);
      const line = String(write.mock.calls[0][0]);
      expect(line.endsWith('\n')).toBe(true);
      expect(JSON.parse(line)).toMatchObject({ operation: 'ler_audit', decision: 'executed' });
    } finally {
      write.mockRestore();
      if (prev === undefined) delete process.env.ARS_AUDIT;
      else process.env.ARS_AUDIT = prev;
    }
  });

  it('a throwing sink does not break the call', async () => {
    const result = await runOperation(plainOp, vi.fn().mockResolvedValue({}), { x: 1 }, {}, {
      onAudit: () => {
        throw new Error('sink down');
      },
    });
    expect(result.isError).toBe(false);
  });
});

describe('runOperation - text carries the whole signpost', () => {
  const typedOp = new OperationHandle(
    {
      id: 'OP-X-01',
      name: 'registrar_x',
      risk_level: 'validated',
      input_schema: { valor: { type: 'decimal', required: true } },
    } satisfies Operation,
    noopAdapter(),
  );

  it('validation_error text has reason, what_to_do and one line per field error', async () => {
    const result = await runOperation(typedOp, vi.fn(), { valor: 'abc' });
    const text = result.content[0].text;

    expect(result.isError).toBe(true);
    expect(text).toContain('Reason:');
    expect(text).toContain('What to do:');
    expect(text).toMatch(/\[valor\] \(INVALID_TYPE\) /);
  });
});
