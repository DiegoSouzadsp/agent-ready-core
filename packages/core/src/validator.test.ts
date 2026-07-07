import { describe, it, expect } from 'vitest';
import { validateInput, applyDefaults, validateForeignKeys, FK_PREDICATE } from '../src/validator.js';
import { createAdapter, noopAdapter } from '../src/adapter.js';
import type { Operation } from '../src/types.js';

// ─────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────

const baseOp: Operation = {
  id: 'OP-TEST-01',
  name: 'registrar_gasto',
  risk_level: 'validated',
  autonomy_policy: 'execute_after_validation',
  input_schema: {
    descricao: { type: 'string', required: true, min_length: 3 },
    valor: {
      type: 'decimal',
      required: true,
      gt: 0,
      human_confirmation_if: { gt: 500 },
    },
    categoria_id: { type: 'int', required: true },
    membro_id: { type: 'int', required: true, infer_from_context: true },
    data: { type: 'date', format: 'YYYY-MM-DD', required: false, default: 'today' },
    conta: {
      type: 'enum',
      values: ['inter', 'c6', 'santander'],
      required: false,
    },
    reembolso: { type: 'bool', required: false, default: false },
    reembolso_por: {
      type: 'string',
      required_if: { field: 'reembolso', value: true },
    },
    data_futura: { type: 'date', required: false, must_be: 'future' },
    nota: { type: 'string', required: false, must_contain: 'NF' },
  },
};

// ─────────────────────────────────────────────
// validateInput
// ─────────────────────────────────────────────

describe('validateInput', () => {
  describe('required fields', () => {
    it('passes when all required fields are present', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 15,
        membro_id: 1,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when required field is missing', () => {
      const result = validateInput(baseOp, { descricao: 'mercado', categoria_id: 15, membro_id: 1 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'valor' && e.code === 'REQUIRED')).toBe(true);
    });

    it('fails on multiple missing required fields', () => {
      const result = validateInput(baseOp, {});
      const codes = result.errors.map(e => e.field);
      expect(codes).toContain('descricao');
      expect(codes).toContain('valor');
      expect(codes).toContain('categoria_id');
    });
  });

  describe('required_if', () => {
    it('requires field when condition is met', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        reembolso: true,
        // reembolso_por missing
      });
      expect(result.errors.some(e => e.field === 'reembolso_por' && e.code === 'REQUIRED_IF')).toBe(true);
    });

    it('does not require field when condition is not met', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        reembolso: false,
      });
      expect(result.errors.some(e => e.field === 'reembolso_por')).toBe(false);
    });
  });

  describe('type checking', () => {
    it('fails on wrong type: int', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 'not-an-int',
        membro_id: 1,
      });
      expect(result.errors.some(e => e.field === 'categoria_id' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('fails on wrong type: decimal', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 'not-a-number',
        categoria_id: 1,
        membro_id: 1,
      });
      expect(result.errors.some(e => e.field === 'valor' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('fails on wrong type: bool', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        reembolso: 'yes',
      });
      expect(result.errors.some(e => e.field === 'reembolso' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('fails on wrong type: date', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        data: 'not-a-date',
      });
      expect(result.errors.some(e => e.field === 'data' && e.code === 'INVALID_TYPE')).toBe(true);
    });
  });

  describe('constraints', () => {
    it('fails on min_length violation', () => {
      const result = validateInput(baseOp, {
        descricao: 'ab',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
      });
      expect(result.errors.some(e => e.field === 'descricao' && e.code === 'MIN_LENGTH')).toBe(true);
    });

    it('fails on gt violation (valor must be > 0)', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 0,
        categoria_id: 1,
        membro_id: 1,
      });
      expect(result.errors.some(e => e.field === 'valor' && e.code === 'GT')).toBe(true);
    });

    it('fails on negative valor', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: -10,
        categoria_id: 1,
        membro_id: 1,
      });
      expect(result.errors.some(e => e.field === 'valor' && e.code === 'GT')).toBe(true);
    });
  });

  describe('format', () => {
    it('fails on invalid date format', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        data: '2026/06/15', // valid date, wrong format
      });
      expect(result.errors.some(e => e.field === 'data' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('passes on valid date format', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        data: '2026-06-15',
      });
      expect(result.errors.some(e => e.field === 'data')).toBe(false);
    });
  });

  describe('enum', () => {
    it('fails when enum value is not in allowed list', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        conta: 'nubank',
      });
      expect(result.errors.some(e => e.field === 'conta' && e.code === 'INVALID_ENUM')).toBe(true);
    });

    it('passes when enum value is valid', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        conta: 'inter',
      });
      expect(result.errors.some(e => e.field === 'conta')).toBe(false);
    });
  });

  describe('must_be', () => {
    it('fails when date is not in the future', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        data_futura: '2020-01-01',
      });
      expect(result.errors.some(e => e.field === 'data_futura' && e.code === 'MUST_BE_FUTURE')).toBe(true);
    });

    it('passes when date is in the future', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        data_futura: '2099-01-01',
      });
      expect(result.errors.some(e => e.field === 'data_futura')).toBe(false);
    });
  });

  describe('must_contain', () => {
    it('fails when string does not contain required substring', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        nota: 'sem numero',
      });
      expect(result.errors.some(e => e.field === 'nota' && e.code === 'MUST_CONTAIN')).toBe(true);
    });

    it('passes when string contains required substring', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
        nota: 'NF-12345',
      });
      expect(result.errors.some(e => e.field === 'nota')).toBe(false);
    });
  });

  describe('human_confirmation_if', () => {
    it('does NOT require confirmation for valor <= 500', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 499,
        categoria_id: 1,
        membro_id: 1,
      });
      expect(result.needsHumanConfirmation).toBe(false);
      expect(result.confirmationReasons).toHaveLength(0);
    });

    it('requires confirmation for valor > 500', () => {
      const result = validateInput(baseOp, {
        descricao: 'carro',
        valor: 501,
        categoria_id: 1,
        membro_id: 1,
      });
      expect(result.needsHumanConfirmation).toBe(true);
      expect(result.confirmationReasons.length).toBeGreaterThan(0);
      expect(result.confirmationReasons[0]).toContain('valor');
    });

    it('requires confirmation for valor exactly 500 (not > 500)', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 500,
        categoria_id: 1,
        membro_id: 1,
      });
      // gt: 500 means strictly greater — 500 is NOT > 500
      expect(result.needsHumanConfirmation).toBe(false);
    });
  });

  describe('context + infer_from_context', () => {
    it('adds warning when infer_from_context field is missing from context', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        // membro_id missing, infer_from_context: true
      }, {});
      expect(result.warnings.some(w => w.field === 'membro_id' && w.code === 'CONTEXT_MISS')).toBe(true);
    });

    it('does not warn when context provides the field', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
      }, { membro_id: 1 });
      expect(result.warnings.some(w => w.field === 'membro_id')).toBe(false);
    });
  });

  describe('risk metadata', () => {
    it('returns the correct risk level from the operation', () => {
      const result = validateInput(baseOp, {
        descricao: 'mercado',
        valor: 50,
        categoria_id: 1,
        membro_id: 1,
      });
      expect(result.riskLevel).toBe('validated');
      expect(result.autonomyPolicy).toBe('execute_after_validation');
    });
  });
});

// ─────────────────────────────────────────────
// applyDefaults
// ─────────────────────────────────────────────

describe('applyDefaults', () => {
  it('applies static default values', () => {
    const result = applyDefaults(baseOp, {
      descricao: 'mercado',
      valor: 50,
      categoria_id: 1,
      membro_id: 1,
    });
    expect(result.reembolso).toBe(false);
  });

  it('applies today default for date fields', () => {
    const result = applyDefaults(baseOp, {
      descricao: 'mercado',
      valor: 50,
      categoria_id: 1,
      membro_id: 1,
    });
    const today = new Date().toISOString().split('T')[0];
    expect(result.data).toBe(today);
  });

  it('infers from context when available', () => {
    const result = applyDefaults(baseOp, {
      descricao: 'mercado',
      valor: 50,
      categoria_id: 1,
    }, { membro_id: 42 });
    expect(result.membro_id).toBe(42);
  });

  it('does not override existing values', () => {
    const result = applyDefaults(baseOp, {
      descricao: 'mercado',
      valor: 50,
      categoria_id: 1,
      membro_id: 99,
      reembolso: true,
    });
    expect(result.reembolso).toBe(true);
    expect(result.membro_id).toBe(99);
  });
});

// ─────────────────────────────────────────────
// validateForeignKeys
// ─────────────────────────────────────────────

describe('validateForeignKeys', () => {
  const fkOp: Operation = {
    id: 'OP-TEST-02',
    name: 'registrar_gasto_fk',
    risk_level: 'validated',
    autonomy_policy: 'execute_after_validation',
    input_schema: {
      categoria_id: {
        type: 'int',
        required: true,
        foreign_key: { table: 'categorias', filter: { ativo: true } },
      },
      membro_id: {
        type: 'int',
        required: false,
        foreign_key: { table: 'membros' },
      },
      descricao: { type: 'string', required: true },
    },
  };

  it('returns no errors when the adapter has no entity.exists resolver', async () => {
    const errors = await validateForeignKeys(fkOp, { categoria_id: 999 }, noopAdapter());
    expect(errors).toEqual([]);
  });

  it('returns FK_NOT_FOUND when the resolver reports the row does not exist', async () => {
    const adapter = createAdapter({
      [FK_PREDICATE]: () => false,
    });
    const errors = await validateForeignKeys(fkOp, { categoria_id: 999, descricao: 'x' }, adapter);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('categoria_id');
    expect(errors[0].code).toBe('FK_NOT_FOUND');
  });

  it('returns no errors when the resolver confirms the row exists', async () => {
    const adapter = createAdapter({
      [FK_PREDICATE]: () => true,
    });
    const errors = await validateForeignKeys(fkOp, { categoria_id: 15, descricao: 'x' }, adapter);
    expect(errors).toEqual([]);
  });

  it('passes table, value, field name and filter to the resolver', async () => {
    const seen: Record<string, unknown>[] = [];
    const adapter = createAdapter({
      [FK_PREDICATE]: (params) => {
        seen.push(params);
        return true;
      },
    });
    await validateForeignKeys(fkOp, { categoria_id: 15 }, adapter);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      table: 'categorias',
      value: 15,
      field: 'categoria_id',
      filter: { ativo: true },
    });
  });

  it('skips absent optional FK fields and non-FK fields', async () => {
    const resolver = { calls: 0 };
    const adapter = createAdapter({
      [FK_PREDICATE]: () => {
        resolver.calls += 1;
        return false;
      },
    });
    // membro_id absent, descricao has no FK — only categoria_id checked
    const errors = await validateForeignKeys(fkOp, { categoria_id: 1, descricao: 'x' }, adapter);
    expect(resolver.calls).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('checks every present FK field independently', async () => {
    const adapter = createAdapter({
      [FK_PREDICATE]: ({ table }) => table === 'categorias', // membros always missing
    });
    const errors = await validateForeignKeys(
      fkOp,
      { categoria_id: 1, membro_id: 7, descricao: 'x' },
      adapter,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('membro_id');
  });
});
