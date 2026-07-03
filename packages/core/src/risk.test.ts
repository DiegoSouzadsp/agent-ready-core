import { describe, it, expect } from 'vitest';
import { assessRisk, compareRisk, getRiskLabel, getRiskMatrix } from '../src/risk.js';
import type { Operation } from '../src/types.js';

const freeOp: Operation = { id: 'OP-01', name: 'op_free', risk_level: 'free', autonomy_policy: 'execute_immediately' };
const validOp: Operation = { id: 'OP-02', name: 'op_valid', risk_level: 'validated', autonomy_policy: 'execute_after_validation' };
const contextOp: Operation = { id: 'OP-03', name: 'op_context', risk_level: 'contextual', autonomy_policy: 'validate_state_then_execute' };
const confirmOp: Operation = { id: 'OP-04', name: 'op_confirm', risk_level: 'confirmation', autonomy_policy: 'require_explicit_confirmation' };

describe('risk', () => {
  describe('assessRisk', () => {
    it('assesses free operations', () => {
      const assessment = assessRisk(freeOp);
      expect(assessment.level).toBe('free');
      expect(assessment.canExecuteAutonomously).toBe(true);
      expect(assessment.needsValidation).toBe(false);
      expect(assessment.needsStateCheck).toBe(false);
      expect(assessment.needsHumanConfirmation).toBe(false);
    });

    it('assesses validated operations', () => {
      const assessment = assessRisk(validOp);
      expect(assessment.level).toBe('validated');
      expect(assessment.canExecuteAutonomously).toBe(true);
      expect(assessment.needsValidation).toBe(true);
      expect(assessment.needsStateCheck).toBe(false);
    });

    it('assesses contextual operations', () => {
      const assessment = assessRisk(contextOp);
      expect(assessment.level).toBe('contextual');
      expect(assessment.canExecuteAutonomously).toBe(true);
      expect(assessment.needsValidation).toBe(true);
      expect(assessment.needsStateCheck).toBe(true);
    });

    it('assesses confirmation operations', () => {
      const assessment = assessRisk(confirmOp);
      expect(assessment.level).toBe('confirmation');
      expect(assessment.canExecuteAutonomously).toBe(false);
      expect(assessment.needsHumanConfirmation).toBe(true);
    });
  });

  describe('compareRisk', () => {
    it('sorts risk levels correctly', () => {
      const risks: Array<'free' | 'validated' | 'contextual' | 'confirmation'> = [
        'confirmation', 'free', 'contextual', 'validated'
      ];
      risks.sort(compareRisk);
      expect(risks).toEqual(['free', 'validated', 'contextual', 'confirmation']);
    });
  });

  describe('getRiskLabel', () => {
    it('returns english label by default', () => {
      expect(getRiskLabel('free')).toContain('Free');
      expect(getRiskLabel('confirmation')).toContain('Confirmation');
    });

    it('returns pt label when requested', () => {
      expect(getRiskLabel('free', 'pt')).toContain('Livre');
      expect(getRiskLabel('confirmation', 'pt')).toContain('Confirmação');
    });
  });

  describe('getRiskMatrix', () => {
    it('returns matrix sorted by highest risk first', () => {
      const matrix = getRiskMatrix([freeOp, confirmOp, validOp, contextOp]);
      
      expect(matrix).toHaveLength(4);
      expect(matrix[0].assessment.level).toBe('confirmation');
      expect(matrix[1].assessment.level).toBe('contextual');
      expect(matrix[2].assessment.level).toBe('validated');
      expect(matrix[3].assessment.level).toBe('free');
    });
  });
});
