import { describe, it, expect } from 'vitest';
import { generateSignpost, renderTemplate, buildAlerts } from '../src/signpost.js';
import type { Operation } from '../src/types.js';

const op: Operation = {
  id: 'OP-FIN-01',
  name: 'registrar_gasto',
  risk_level: 'validated',
  autonomy_policy: 'execute_after_validation',
  human_confirmation: {
    message_template: 'Confirmar: valor {{valor}}, local {{descricao}}, data {{data}}?',
  },
  side_effects: [
    {
      id: 'check_budget',
      description: 'Checar envelope',
      alert_if: { gte: 0.8 },
      message_template: 'Envelope {{categoria}} em {{percentual}}% do orçamento.',
    },
  ],
  signpost: {
    success: {
      include: ['gasto_id', 'percentual'],
      message: 'Gasto registrado com sucesso.',
      next_actions: [
        'consulta_mes',
        { operation: 'atualizar_gasto', reason: 'Corrigir se necessário' },
      ],
    },
    validation_error: {
      message: 'Não foi possível registrar o gasto.',
      next_actions: ['registrar_gasto'],
    },
    not_found: {
      guidance: 'Gasto não encontrado. Use consulta_mes para ver todos os gastos.',
      suggestions: ['consulta_mes'],
    },
    blocked_transition: {
      message_template: 'Bloqueado: {{reason}}',
      next_actions: ['consulta_mes'],
    },
  },
};

describe('renderTemplate', () => {
  it('replaces {{field}} placeholders', () => {
    expect(renderTemplate('Olá {{name}}!', { name: 'Diego' })).toBe('Olá Diego!');
  });

  it('handles missing fields gracefully', () => {
    expect(renderTemplate('Valor: {{valor}}', {})).toBe('Valor: [valor]');
  });

  it('handles multiple placeholders', () => {
    const result = renderTemplate('{{a}} e {{b}}', { a: '1', b: '2' });
    expect(result).toBe('1 e 2');
  });
});

describe('generateSignpost', () => {
  describe('success', () => {
    it('returns type success', () => {
      const sp = generateSignpost(op, 'success', { gasto_id: 42, percentual: 0.82, extra: 'ignored' });
      expect(sp.type).toBe('success');
    });

    it('always has guidance (Rule 3)', () => {
      const sp = generateSignpost(op, 'success', {});
      expect(typeof sp.guidance).toBe('string');
      expect(sp.guidance.length).toBeGreaterThan(0);
    });

    it('always has _context (Rule 4)', () => {
      const sp = generateSignpost(op, 'success', {});
      expect(sp._context.operation).toBe('registrar_gasto');
      expect(sp._context.risk_level).toBe('validated');
    });

    it('filters data by include list', () => {
      const sp = generateSignpost(op, 'success', { gasto_id: 42, percentual: 0.82, extra: 'ignored' });
      expect(sp.data?.gasto_id).toBe(42);
      expect(sp.data?.percentual).toBe(0.82);
      expect(sp.data?.extra).toBeUndefined();
    });

    it('normalizes string next_actions to NextAction with reason', () => {
      const sp = generateSignpost(op, 'success', {});
      expect(sp.next).toBeDefined();
      const consulta = sp.next?.find(n => n.operation === 'consulta_mes');
      expect(consulta).toBeDefined();
      expect(typeof consulta?.reason).toBe('string');
    });

    it('preserves explicit reason in next_actions', () => {
      const sp = generateSignpost(op, 'success', {});
      const atualizar = sp.next?.find(n => n.operation === 'atualizar_gasto');
      expect(atualizar?.reason).toBe('Corrigir se necessário');
    });
  });

  describe('validation_error (Rule 1: errors must teach)', () => {
    const errors = [
      { field: 'valor', code: 'REQUIRED', message: 'Field "valor" is required' },
    ];

    it('returns type validation_error', () => {
      const sp = generateSignpost(op, 'validation_error', { errors });
      expect(sp.type).toBe('validation_error');
    });

    it('has reason (Rule 1)', () => {
      const sp = generateSignpost(op, 'validation_error', { errors });
      expect(typeof sp.reason).toBe('string');
      expect(sp.reason!.length).toBeGreaterThan(0);
    });

    it('has what_to_do (Rule 1)', () => {
      const sp = generateSignpost(op, 'validation_error', { errors });
      expect(typeof sp.what_to_do).toBe('string');
      expect(sp.what_to_do).toContain('valor');
    });

    it('passes through errors array', () => {
      const sp = generateSignpost(op, 'validation_error', { errors });
      expect(sp.errors).toEqual(errors);
    });

    it('has suggestions', () => {
      const sp = generateSignpost(op, 'validation_error', { errors });
      expect(sp.suggestions).toBeDefined();
      expect(sp.suggestions?.some(s => s.operation === 'registrar_gasto')).toBe(true);
    });

    it('always has guidance (Rule 3)', () => {
      const sp = generateSignpost(op, 'validation_error', { errors });
      expect(sp.guidance.length).toBeGreaterThan(0);
    });
  });

  describe('not_found (Rule 1: A 404 with guidance > 200 with silence)', () => {
    it('returns type not_found', () => {
      const sp = generateSignpost(op, 'not_found', { id: 999 });
      expect(sp.type).toBe('not_found');
    });

    it('has guidance with instructions', () => {
      const sp = generateSignpost(op, 'not_found', {});
      expect(sp.guidance).toContain('consulta_mes');
    });

    it('has suggestions pointing to alternatives', () => {
      const sp = generateSignpost(op, 'not_found', {});
      expect(sp.suggestions?.some(s => s.operation === 'consulta_mes')).toBe(true);
    });
  });

  describe('pending (human confirmation)', () => {
    it('returns type pending', () => {
      const sp = generateSignpost(op, 'pending', { valor: 600, descricao: 'carro', data: '2026-06-15' });
      expect(sp.type).toBe('pending');
    });

    it('renders message_template for pending', () => {
      const sp = generateSignpost(op, 'pending', { valor: 600, descricao: 'carro', data: '2026-06-15' });
      expect(sp.guidance).toContain('600');
      expect(sp.guidance).toContain('carro');
    });
  });

  describe('blocked_transition', () => {
    it('returns type blocked_transition', () => {
      const sp = generateSignpost(op, 'blocked_transition', { reason: 'Mês fechado' });
      expect(sp.type).toBe('blocked_transition');
    });

    it('renders message_template with data', () => {
      const sp = generateSignpost(op, 'blocked_transition', { reason: 'Mês fechado' });
      expect(sp.guidance).toContain('Mês fechado');
    });
  });

  describe('operation with no signpost config', () => {
    const bareOp: Operation = {
      id: 'OP-BARE',
      name: 'bare_op',
      risk_level: 'free',
      autonomy_policy: 'execute_immediately',
    };

    it('generates default success signpost', () => {
      const sp = generateSignpost(bareOp, 'success', {});
      expect(sp.type).toBe('success');
      expect(sp.guidance).toContain('bare_op');
    });

    it('generates default not_found signpost', () => {
      const sp = generateSignpost(bareOp, 'not_found', {});
      expect(sp.type).toBe('not_found');
      expect(sp.guidance.length).toBeGreaterThan(0);
    });
  });
});

describe('buildAlerts', () => {
  it('returns empty array when no side_effects', () => {
    const bare: Operation = {
      id: 'OP-BARE',
      name: 'bare',
      risk_level: 'free',
      autonomy_policy: 'execute_immediately',
    };
    expect(buildAlerts(bare, {})).toEqual([]);
  });

  it('triggers alert when threshold is exceeded', () => {
    const alerts = buildAlerts(op, { categoria: 'Mercado', percentual: 0.85 });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].level).toBe('warning');
    expect(alerts[0].reason).toContain('Mercado');
  });

  it('does not trigger alert below threshold', () => {
    const alerts = buildAlerts(op, { percentual: 0.5 });
    expect(alerts).toHaveLength(0);
  });

  it('uses critical level when at 100%', () => {
    const alerts = buildAlerts(op, { categoria: 'Mercado', percentual: 1.0 });
    expect(alerts.some(a => a.level === 'critical')).toBe(true);
  });
});
