import type { Operation, RiskLevel, AutonomyPolicy } from './types.js';

// ─────────────────────────────────────────────
// Risk Assessment
// ─────────────────────────────────────────────

/** Structured risk assessment for an operation */
export interface RiskAssessment {
  level: RiskLevel;
  policy: AutonomyPolicy;
  label: string;
  emoji: string;
  description: string;
  canExecuteAutonomously: boolean;
  needsValidation: boolean;
  needsStateCheck: boolean;
  needsHumanConfirmation: boolean;
}

/** Entry in the risk matrix */
export interface RiskMatrixEntry {
  id: string;
  name: string;
  assessment: RiskAssessment;
}

const RISK_ORDER: RiskLevel[] = ['free', 'validated', 'contextual', 'confirmation'];

const RISK_META: Record<
  RiskLevel,
  {
    emoji: string;
    label_en: string;
    label_pt: string;
    description: string;
    policy: AutonomyPolicy;
    canExecuteAutonomously: boolean;
    needsValidation: boolean;
    needsStateCheck: boolean;
    needsHumanConfirmation: boolean;
  }
> = {
  free: {
    emoji: '🟢',
    label_en: 'Free — Execute immediately',
    label_pt: 'Livre — Executa imediatamente',
    description: 'No validation required. Agent executes immediately.',
    policy: 'execute_immediately',
    canExecuteAutonomously: true,
    needsValidation: false,
    needsStateCheck: false,
    needsHumanConfirmation: false,
  },
  validated: {
    emoji: '🟡',
    label_en: 'Validated — Validate before executing',
    label_pt: 'Validado — Valida antes de executar',
    description: 'Agent must validate inputs before executing.',
    policy: 'execute_after_validation',
    canExecuteAutonomously: true,
    needsValidation: true,
    needsStateCheck: false,
    needsHumanConfirmation: false,
  },
  contextual: {
    emoji: '🟠',
    label_en: 'Contextual — Validate state then execute',
    label_pt: 'Contextual — Valida estado e executa',
    description: 'Agent must validate inputs AND check state guards before executing.',
    policy: 'validate_state_then_execute',
    canExecuteAutonomously: true,
    needsValidation: true,
    needsStateCheck: true,
    needsHumanConfirmation: false,
  },
  confirmation: {
    emoji: '🔴',
    label_en: 'Confirmation — Requires explicit confirmation',
    label_pt: 'Confirmação — Exige confirmação explícita',
    description: 'Agent must always ask the human before executing. No autonomous execution.',
    policy: 'require_explicit_confirmation',
    canExecuteAutonomously: false,
    needsValidation: true,
    needsStateCheck: true,
    needsHumanConfirmation: true,
  },
};

/**
 * Assess the risk level of an operation.
 * Returns a structured assessment with flags for what the agent needs to do.
 */
export function assessRisk(operation: Operation): RiskAssessment {
  const meta = RISK_META[operation.risk_level];
  return {
    level: operation.risk_level,
    policy: meta.policy,
    label: `${meta.emoji} ${meta.label_en}`,
    emoji: meta.emoji,
    description: meta.description,
    canExecuteAutonomously: meta.canExecuteAutonomously,
    needsValidation: meta.needsValidation,
    needsStateCheck: meta.needsStateCheck,
    needsHumanConfirmation: meta.needsHumanConfirmation,
  };
}

/**
 * Compare two risk levels (for sorting).
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Order: free < validated < contextual < confirmation
 */
export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return RISK_ORDER.indexOf(a) - RISK_ORDER.indexOf(b);
}

/**
 * Get a localized label for a risk level with emoji.
 */
export function getRiskLabel(level: RiskLevel, locale: 'en' | 'pt' = 'en'): string {
  const meta = RISK_META[level];
  const label = locale === 'pt' ? meta.label_pt : meta.label_en;
  return `${meta.emoji} ${label}`;
}

/**
 * Build a risk matrix for a list of operations, sorted highest risk first.
 */
export function getRiskMatrix(operations: Operation[]): RiskMatrixEntry[] {
  return [...operations]
    .sort((a, b) => compareRisk(b.risk_level, a.risk_level))
    .map((op) => ({
      id: op.id,
      name: op.name,
      assessment: assessRisk(op),
    }));
}
