import type {
  Operation,
  SignpostResult,
  NextAction,
  SignpostAlert,
  FieldError,
  AlertIf,
} from './types.js';

// ─────────────────────────────────────────────
// Template rendering
// ─────────────────────────────────────────────

/**
 * Replace {{field}} placeholders with values from data.
 * Rule 4: The agent has only this response — make it self-sufficient.
 *
 * @param template - String with {{field}} placeholders
 * @param data - Values to substitute
 */
export function renderTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = data[key];
    return val !== undefined ? String(val) : `[${key}]`;
  });
}

// ─────────────────────────────────────────────
// Alert builder
// ─────────────────────────────────────────────

function checkAlertIf(alertIf: AlertIf, value: number): boolean {
  if (alertIf.gte !== undefined && value >= alertIf.gte) return true;
  if (alertIf.gt !== undefined && value > alertIf.gt) return true;
  if (alertIf.lte !== undefined && value <= alertIf.lte) return true;
  if (alertIf.lt !== undefined && value < alertIf.lt) return true;
  if (alertIf.eq !== undefined && value === alertIf.eq) return true;
  return false;
}

/**
 * Check operation side_effects with alert_if conditions against result data.
 * Returns alerts to include in the signpost.
 */
export function buildAlerts(
  operation: Operation,
  data: Record<string, unknown>,
): SignpostAlert[] {
  const alerts: SignpostAlert[] = [];
  if (!operation.side_effects) return alerts;

  for (const effect of operation.side_effects) {
    if (!effect.alert_if || !effect.message_template) continue;

    // Look for a numeric value in data matching the effect id or common keys
    const pctKey = Object.keys(data).find((k) =>
      k.includes('pct') || k.includes('percent') || k.includes('percentual'),
    );
    const numericValue =
      typeof data[effect.id] === 'number'
        ? (data[effect.id] as number)
        : pctKey && typeof data[pctKey] === 'number'
          ? (data[pctKey] as number)
          : null;

    if (numericValue !== null && checkAlertIf(effect.alert_if, numericValue)) {
      const rendered = renderTemplate(effect.message_template, data);
      const level: SignpostAlert['level'] =
        numericValue >= 1.0 ? 'critical' : numericValue >= 0.8 ? 'warning' : 'info';
      alerts.push({ level, reason: rendered });
    }
  }

  return alerts;
}

// ─────────────────────────────────────────────
// Next action normalizer
// ─────────────────────────────────────────────

function normalizeNextActions(
  actions: (string | NextAction)[] | undefined,
): NextAction[] {
  if (!actions) return [];
  return actions.map((a) =>
    typeof a === 'string'
      ? { operation: a, reason: `Continue with ${a}` }
      : a,
  );
}

// ─────────────────────────────────────────────
// Signpost generator
// ─────────────────────────────────────────────

/**
 * Generate a runtime signpost result for an operation.
 *
 * Implements Felipe Amorim's 4 rules:
 * - Rule 1: Errors must teach (reason + what_to_do + suggestions)
 * - Rule 3: Every response is a signpost (guidance always present)
 * - Rule 4: Write for reader who cannot see docs (_context is self-sufficient)
 *
 * @param operation - The operation that was executed
 * @param type - Signpost type: 'success' | 'validation_error' | 'not_found' | 'pending' | 'blocked_transition' | 'low_confidence'
 * @param data - Result data or error context
 */
export function generateSignpost(
  operation: Operation,
  type: SignpostResult['type'],
  data: Record<string, unknown> = {},
): SignpostResult {
  const config = operation.signpost ?? {};
  const baseContext: SignpostResult['_context'] = {
    operation: operation.name,
    risk_level: operation.risk_level,
  };

  switch (type) {
    case 'success': {
      const successCfg = config.success;

      // Filter data to only included fields
      const filteredData: Record<string, unknown> = {};
      if (successCfg?.include) {
        for (const key of successCfg.include) {
          if (data[key] !== undefined) filteredData[key] = data[key];
        }
      } else {
        Object.assign(filteredData, data);
      }

      // Render guidance
      let guidance =
        successCfg?.message_template
          ? renderTemplate(successCfg.message_template, data)
          : successCfg?.message
            ?? `Operation "${operation.name}" completed successfully.`;

      const alerts = buildAlerts(operation, data);

      // Build next actions
      const next = normalizeNextActions(successCfg?.next_actions);

      return {
        type: 'success',
        guidance,
        _context: { ...baseContext, what_happened: `${operation.name} executed successfully` },
        data: filteredData,
        alerts,
        next,
      };
    }

    case 'validation_error': {
      const errCfg = config.validation_error;
      const errors = (data.errors as FieldError[]) ?? [];

      const reason =
        errCfg?.message_template
          ? renderTemplate(errCfg.message_template, data)
          : errCfg?.message
            ?? `Could not execute "${operation.name}" — validation failed.`;

      const what_to_do =
        errors.length > 0
          ? `Fix the following fields: ${errors.map((e) => e.field).join(', ')}`
          : `Check the required fields for "${operation.name}" and try again.`;

      const suggestions = normalizeNextActions(errCfg?.next_actions);

      return {
        type: 'validation_error',
        // Rule 3: guidance always present
        guidance: `${reason} ${what_to_do}`,
        _context: { ...baseContext, what_happened: 'Validation failed' },
        // Rule 1: Errors must teach
        reason,
        what_to_do,
        errors,
        suggestions,
      };
    }

    case 'not_found': {
      const nfCfg = config.not_found;

      // Rule 1: A 404 with guidance is worth more than a 200 with silence
      const guidance =
        nfCfg?.guidance
          ? renderTemplate(nfCfg.guidance, data)
          : `Resource not found. You can search or list available items using the suggestions below.`;

      const suggestions = normalizeNextActions(
        nfCfg?.suggestions as (string | NextAction)[] | undefined,
      );

      return {
        type: 'not_found',
        guidance,
        _context: { ...baseContext, what_happened: 'Resource not found' },
        reason: `The requested resource does not exist`,
        what_to_do: `Try searching or listing available resources`,
        suggestions,
      };
    }

    case 'pending': {
      const pendingCfg = config.pending;
      const confirmCfg = operation.human_confirmation;

      const guidance =
        confirmCfg?.message_template
          ? renderTemplate(confirmCfg.message_template, data)
          : pendingCfg?.message_template
            ? renderTemplate(pendingCfg.message_template, data)
            : pendingCfg?.message
              ?? `Operation "${operation.name}" is pending human confirmation.`;

      const filteredData: Record<string, unknown> = {};
      if (pendingCfg?.include) {
        for (const key of pendingCfg.include) {
          if (data[key] !== undefined) filteredData[key] = data[key];
        }
      } else {
        Object.assign(filteredData, data);
      }

      return {
        type: 'pending',
        guidance,
        _context: { ...baseContext, what_happened: 'Waiting for human confirmation' },
        data: filteredData,
        reason: 'This operation requires explicit human confirmation before executing.',
        what_to_do: 'Please confirm or cancel the operation.',
      };
    }

    case 'blocked_transition': {
      const blockedCfg = config.blocked_transition;

      const guidance =
        blockedCfg?.message_template
          ? renderTemplate(blockedCfg.message_template, data)
          : blockedCfg?.message
            ?? `Cannot execute "${operation.name}" — a pre-condition was not met.`;

      const suggestions = normalizeNextActions(blockedCfg?.next_actions);

      return {
        type: 'blocked_transition',
        guidance,
        _context: { ...baseContext, what_happened: 'State guard blocked execution' },
        reason: (data.reason as string) ?? 'A required state condition was not met.',
        what_to_do: (data.what_to_do as string) ?? 'Check the conditions and try again.',
        suggestions,
      };
    }

    case 'low_confidence': {
      const lcCfg = config.low_confidence;

      const guidance =
        lcCfg?.message_template
          ? renderTemplate(lcCfg.message_template, data)
          : lcCfg?.message
            ?? `Low confidence in the extracted data for "${operation.name}". Please confirm.`;

      const suggestions = normalizeNextActions(lcCfg?.next_actions);

      return {
        type: 'low_confidence',
        guidance,
        _context: { ...baseContext, what_happened: 'Low confidence in extracted data' },
        reason: 'The confidence score is below the required threshold.',
        what_to_do: 'Please review and confirm the extracted values.',
        data,
        suggestions,
      };
    }
  }
}
