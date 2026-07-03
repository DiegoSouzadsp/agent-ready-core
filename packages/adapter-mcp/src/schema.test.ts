import { describe, it, expect } from 'vitest';
import type { InputField, Operation } from '@agent-ready/core';
import { inputFieldsToZodShape, operationInputSchema } from './schema.js';

function field(overrides: Partial<InputField>): InputField {
  return { name: 'f', type: 'string', ...overrides };
}

describe('inputFieldsToZodShape', () => {
  it('maps string fields to z.string()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'descricao', type: 'string', required: true })]);
    expect(shape.descricao.safeParse('mercado').success).toBe(true);
    expect(shape.descricao.safeParse(123).success).toBe(false);
  });

  it('maps int fields to z.number().int()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'categoria_id', type: 'int', required: true })]);
    expect(shape.categoria_id.safeParse(5).success).toBe(true);
    expect(shape.categoria_id.safeParse(5.5).success).toBe(false);
    expect(shape.categoria_id.safeParse('5').success).toBe(false);
  });

  it('maps decimal fields to z.number()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'valor', type: 'decimal', required: true })]);
    expect(shape.valor.safeParse(50.5).success).toBe(true);
    expect(shape.valor.safeParse('50.5').success).toBe(false);
  });

  it('maps bool fields to z.boolean()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'reembolso', type: 'bool', required: true })]);
    expect(shape.reembolso.safeParse(true).success).toBe(true);
    expect(shape.reembolso.safeParse('true').success).toBe(false);
  });

  it('maps date fields to z.string()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'data', type: 'date', required: true })]);
    expect(shape.data.safeParse('2026-07-03').success).toBe(true);
  });

  it('maps datetime fields to z.string()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'ts', type: 'datetime', required: true })]);
    expect(shape.ts.safeParse('2026-07-03T10:00:00Z').success).toBe(true);
  });

  it('maps enum fields with values to z.enum()', () => {
    const shape = inputFieldsToZodShape([
      field({ name: 'conta', type: 'enum', values: ['inter', 'c6', 'santander'], required: true }),
    ]);
    expect(shape.conta.safeParse('inter').success).toBe(true);
    expect(shape.conta.safeParse('nubank').success).toBe(false);
  });

  it('falls back to z.string() when enum has no values', () => {
    const shape = inputFieldsToZodShape([field({ name: 'conta', type: 'enum', required: true })]);
    expect(shape.conta.safeParse('anything').success).toBe(true);
  });

  it('falls back to z.string() when enum values is an empty array', () => {
    const shape = inputFieldsToZodShape([field({ name: 'conta', type: 'enum', values: [], required: true })]);
    expect(shape.conta.safeParse('anything').success).toBe(true);
  });

  it('maps base64 fields to z.string()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'foto', type: 'base64', required: true })]);
    expect(shape.foto.safeParse('aGVsbG8=').success).toBe(true);
  });

  it('maps any fields to z.any()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'payload', type: 'any', required: true })]);
    expect(shape.payload.safeParse({ x: 1 }).success).toBe(true);
    expect(shape.payload.safeParse('x').success).toBe(true);
  });

  it('does not wrap required:true fields in .optional()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'valor', type: 'decimal', required: true })]);
    expect(shape.valor.safeParse(undefined).success).toBe(false);
  });

  it('wraps required:false fields in .optional()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'conta', type: 'string', required: false })]);
    expect(shape.conta.safeParse(undefined).success).toBe(true);
  });

  it('wraps fields with no required key in .optional()', () => {
    const shape = inputFieldsToZodShape([field({ name: 'conta', type: 'string' })]);
    expect(shape.conta.safeParse(undefined).success).toBe(true);
  });

  it('attaches field.description via .describe()', () => {
    const shape = inputFieldsToZodShape([
      field({ name: 'valor', type: 'decimal', required: true, description: 'Valor do gasto em reais' }),
    ]);
    expect(shape.valor.description).toBe('Valor do gasto em reais');
  });

  it('does not enforce gt/gte/min/max/min_length/max_length at the Zod layer (Tech Decision)', () => {
    const shape = inputFieldsToZodShape([
      field({ name: 'valor', type: 'decimal', required: true, gt: 500 }),
      field({ name: 'descricao', type: 'string', required: true, min_length: 10 }),
    ]);
    // A value that violates gt/min_length still parses successfully at the Zod level —
    // ARS's own validateInput() is the sole enforcer of these constraints (pipeline.ts).
    expect(shape.valor.safeParse(1).success).toBe(true);
    expect(shape.descricao.safeParse('hi').success).toBe(true);
  });
});

describe('operationInputSchema', () => {
  it('derives the Zod shape from an Operation with a map-style input_schema', () => {
    const operation: Operation = {
      id: 'OP-TEST-01',
      name: 'test_op',
      risk_level: 'validated',
      autonomy_policy: 'execute_after_validation',
      input_schema: {
        valor: { type: 'decimal', required: true, gt: 0 },
        descricao: { type: 'string', required: false },
      },
    };

    const shape = operationInputSchema(operation);

    expect(Object.keys(shape).sort()).toEqual(['descricao', 'valor']);
    expect(shape.valor.safeParse(50).success).toBe(true);
    expect(shape.descricao.safeParse(undefined).success).toBe(true);
  });

  it('returns an empty shape for an operation with no input_schema', () => {
    const operation: Operation = {
      id: 'OP-TEST-02',
      name: 'test_op_2',
      risk_level: 'free',
      autonomy_policy: 'execute_immediately',
    };

    expect(operationInputSchema(operation)).toEqual({});
  });
});
