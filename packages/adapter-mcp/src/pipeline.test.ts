import { describe, it, expect, vi } from 'vitest';
import { OperationHandle, noopAdapter } from '@agent-ready/core';
import type { Operation } from '@agent-ready/core';
import { runOperation } from './pipeline.js';

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
    expect(result.content[0].text).toBe((result.structuredContent as any).guidance);
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
