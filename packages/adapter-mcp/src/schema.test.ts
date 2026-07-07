import { describe, it, expect } from 'vitest';
import type { InputField, Operation } from '@agent-ready/core';
import {
  fieldConstraintSummary,
  inputFieldsToZodShape,
  operationInputSchema,
  operationToolDescription,
  operationToolAnnotations,
} from './schema.js';

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

  it('attaches field.description via .describe(), enriched with the [rules: ...] summary', () => {
    const shape = inputFieldsToZodShape([
      field({ name: 'valor', type: 'decimal', required: true, description: 'Valor do gasto em reais' }),
    ]);
    expect(shape.valor.description).toBe('Valor do gasto em reais [rules: required]');
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

describe('operationToolDescription', () => {
  function op(overrides: Partial<Operation>): Operation {
    return {
      id: 'OP-X',
      name: 'op_x',
      description: 'Does the thing',
      risk_level: 'free',
      autonomy_policy: 'execute_immediately',
      ...overrides,
    };
  }

  it('prefixes the description with a [risk: <level>] tag for each risk level', () => {
    expect(operationToolDescription(op({ risk_level: 'free' }))).toBe('[risk: free] Does the thing');
    expect(operationToolDescription(op({ risk_level: 'validated' }))).toBe('[risk: validated] Does the thing');
    expect(operationToolDescription(op({ risk_level: 'contextual' }))).toBe('[risk: contextual] Does the thing');
  });

  it('appends an explicit "always requires confirmation" note for risk_level:confirmation', () => {
    const result = operationToolDescription(op({ risk_level: 'confirmation' }));
    expect(result).toBe(
      '[risk: confirmation] Does the thing — always requires explicit human confirmation; this call returns a pending response and never executes on its own.',
    );
  });

  it('appends a conditional-confirmation note when a field has human_confirmation_if, on a non-confirmation-risk operation', () => {
    const operation = op({
      risk_level: 'validated',
      input_schema: {
        valor: { type: 'decimal', required: true, human_confirmation_if: { gt: 500 } },
      },
    });

    expect(operationToolDescription(operation)).toBe(
      '[risk: validated] Does the thing — may require human confirmation depending on input values.',
    );
  });

  it('does not append any confirmation note when no field has human_confirmation_if', () => {
    const operation = op({
      risk_level: 'validated',
      input_schema: { valor: { type: 'decimal', required: true } },
    });

    expect(operationToolDescription(operation)).toBe('[risk: validated] Does the thing');
  });

  it('falls back to the operation name when description is absent', () => {
    const operation = op({ description: undefined });
    expect(operationToolDescription(operation)).toBe('[risk: free] op_x');
  });
});

describe('operationToolAnnotations', () => {
  function op(risk_level: Operation['risk_level']): Operation {
    return { id: 'OP-X', name: 'op_x', risk_level, autonomy_policy: 'execute_immediately' };
  }

  it('sets readOnlyHint:true for risk_level:free', () => {
    expect(operationToolAnnotations(op('free'))).toEqual({ readOnlyHint: true });
  });

  it('sets destructiveHint:true for risk_level:confirmation', () => {
    expect(operationToolAnnotations(op('confirmation'))).toEqual({ destructiveHint: true });
  });

  it('returns undefined for risk_level:validated and risk_level:contextual (no single hint fits)', () => {
    expect(operationToolAnnotations(op('validated'))).toBeUndefined();
    expect(operationToolAnnotations(op('contextual'))).toBeUndefined();
  });
});

describe('fieldConstraintSummary', () => {
  it('returns empty string for a bare field', () => {
    expect(fieldConstraintSummary(field({ name: 'obs', type: 'string' }))).toBe('');
  });

  it('summarizes numeric and length constraints', () => {
    const summary = fieldConstraintSummary(
      field({ name: 'valor', type: 'decimal', required: true, gt: 0, max: 10000 }),
    );
    expect(summary).toContain('required');
    expect(summary).toContain('must be > 0');
    expect(summary).toContain('max 10000');
  });

  it('summarizes format, default and required_if', () => {
    const summary = fieldConstraintSummary(
      field({
        name: 'data',
        type: 'date',
        format: 'YYYY-MM-DD',
        default: 'today',
        required_if: { field: 'reembolso', value: true },
      }),
    );
    expect(summary).toContain('format YYYY-MM-DD');
    expect(summary).toContain('default "today"');
    expect(summary).toContain('required when reembolso = true');
  });

  it('summarizes foreign_key with table and filter', () => {
    const summary = fieldConstraintSummary(
      field({
        name: 'categoria_id',
        type: 'int',
        foreign_key: { table: 'categorias', filter: { ativo: true } },
      }),
    );
    expect(summary).toContain('must reference an existing row in "categorias"');
    expect(summary).toContain('ativo=true');
  });

  it('summarizes human_confirmation_if conditions', () => {
    const summary = fieldConstraintSummary(
      field({ name: 'valor', type: 'decimal', human_confirmation_if: { gt: 500 } }),
    );
    expect(summary).toContain('triggers human confirmation if value > 500');
  });
});

describe('inputFieldsToZodShape — enriched descriptions', () => {
  it('appends the [rules: ...] summary to the field description', () => {
    const shape = inputFieldsToZodShape([
      field({
        name: 'valor',
        type: 'decimal',
        required: true,
        gt: 0,
        description: 'Valor do gasto em reais',
      }),
    ]);
    expect(shape.valor.description).toBe('Valor do gasto em reais [rules: required; must be > 0]');
  });

  it('uses only the [rules: ...] summary when the field has no description', () => {
    const shape = inputFieldsToZodShape([
      field({ name: 'valor', type: 'decimal', required: true, gt: 0 }),
    ]);
    expect(shape.valor.description).toBe('[rules: required; must be > 0]');
  });

  it('keeps the plain description when there are no constraints', () => {
    const shape = inputFieldsToZodShape([
      field({ name: 'obs', type: 'string', description: 'Observações livres' }),
    ]);
    expect(shape.obs.description).toBe('Observações livres');
  });

  it('does not encode constraints into Zod validation (stays protocol-safe)', () => {
    const shape = inputFieldsToZodShape([
      field({ name: 'valor', type: 'decimal', required: true, gt: 0 }),
    ]);
    // -5 violates gt:0 but must still pass Zod — ARS validateInput() rejects it
    // later with a proper validation_error signpost.
    expect(shape.valor.safeParse(-5).success).toBe(true);
  });
});
