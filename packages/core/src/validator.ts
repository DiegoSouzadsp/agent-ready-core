import type {
  Operation,
  InputField,
  ValidationResult,
  FieldError,
} from './types.js';
import { getInputFields } from './loader.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return isNaN(value) ? null : value;
  if (typeof value === 'string') {
    const n = parseFloat(value.replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  return null;
}

function isValidDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

function isFuture(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return new Date(value) > new Date();
}

function isPast(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return new Date(value) < new Date();
}

function isToday(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const today = new Date().toISOString().split('T')[0];
  return value.startsWith(today);
}

const DATE_YYYYMMDD = /^\d{4}-\d{2}-\d{2}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function fieldError(field: string, code: string, message: string): FieldError {
  return { field, code, message };
}

// ─────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────

/**
 * Apply defaults from the schema to an input object.
 * Order: infer_from_context → default_by_tipo → default
 *
 * @param operation - The operation definition
 * @param input - The raw input from the agent
 * @param context - Agent context (membro_id, conta, etc.)
 */
export function applyDefaults(
  operation: Operation,
  input: Record<string, unknown>,
  context: Record<string, unknown> = {},
): Record<string, unknown> {
  const result = { ...input };
  const fields = getInputFields(operation);

  for (const field of fields) {
    const name = field.name!;
    if (isPresent(result[name])) continue;

    // 1. Infer from context
    if (field.infer_from_context && isPresent(context[name])) {
      result[name] = context[name];
      continue;
    }

    // 2. Default by tipo (if there's a 'tipo' field in input)
    if (field.default_by_tipo && isPresent(result['tipo'])) {
      const byTipo = field.default_by_tipo[result['tipo'] as string];
      if (byTipo !== undefined) {
        result[name] = byTipo;
        continue;
      }
    }

    // 3. Static default
    if (field.default !== undefined) {
      result[name] =
        field.default === 'today'
          ? new Date().toISOString().split('T')[0]
          : field.default;
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// Core Validator
// ─────────────────────────────────────────────

/**
 * Validate an input object against an operation's input schema.
 *
 * Validation order:
 * 1. Required fields (required + required_if)
 * 2. Type checking
 * 3. Constraints (min/max, gt/gte, min_length/max_length)
 * 4. Format validation
 * 5. Enum check
 * 6. must_be (date constraints)
 * 7. must_contain
 * 8. human_confirmation_if
 *
 * @param operation - The operation definition
 * @param input - Input after applyDefaults()
 * @param context - Agent context for infer_from_context fields
 */
export function validateInput(
  operation: Operation,
  input: Record<string, unknown>,
  context: Record<string, unknown> = {},
): ValidationResult {
  const errors: FieldError[] = [];
  const warnings: FieldError[] = [];
  let needsHumanConfirmation = false;
  const confirmationReasons: string[] = [];

  const fields = getInputFields(operation);

  for (const field of fields) {
    const name = field.name!;
    const value = input[name];
    const present = isPresent(value);

    // ── Required ──────────────────────────────
    if (field.required && !present) {
      // Unless it has a default (which applyDefaults should have handled)
      if (field.default === undefined && !field.infer_from_context) {
        errors.push(fieldError(name, 'REQUIRED', `Field "${name}" is required`));
      } else if (field.infer_from_context && !isPresent(context[name])) {
        warnings.push(
          fieldError(name, 'CONTEXT_MISS', `Field "${name}" should be inferred from context but was not found`),
        );
      }
      continue;
    }

    // ── required_if ───────────────────────────
    if (field.required_if && !present) {
      const { field: condField, value: condValue } = field.required_if;
      if (input[condField] === condValue) {
        errors.push(
          fieldError(
            name,
            'REQUIRED_IF',
            `Field "${name}" is required when "${condField}" is "${condValue}"`,
          ),
        );
        continue;
      }
    }

    // Skip further checks if field is not present and not required
    if (!present) continue;

    // ── Type checking ─────────────────────────
    switch (field.type) {
      case 'int': {
        const n = parseNumber(value);
        if (n === null || !Number.isInteger(n)) {
          errors.push(fieldError(name, 'INVALID_TYPE', `Field "${name}" must be an integer`));
          continue;
        }
        break;
      }
      case 'decimal': {
        const n = parseNumber(value);
        if (n === null) {
          errors.push(fieldError(name, 'INVALID_TYPE', `Field "${name}" must be a number`));
          continue;
        }
        break;
      }
      case 'bool': {
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors.push(fieldError(name, 'INVALID_TYPE', `Field "${name}" must be a boolean`));
          continue;
        }
        break;
      }
      case 'date': {
        if (!isValidDate(value)) {
          errors.push(fieldError(name, 'INVALID_TYPE', `Field "${name}" must be a valid date`));
          continue;
        }
        break;
      }
      case 'datetime': {
        if (typeof value !== 'string' || isNaN(new Date(value).getTime())) {
          errors.push(fieldError(name, 'INVALID_TYPE', `Field "${name}" must be a valid datetime`));
          continue;
        }
        break;
      }
      case 'string': {
        if (typeof value !== 'string') {
          errors.push(fieldError(name, 'INVALID_TYPE', `Field "${name}" must be a string`));
          continue;
        }
        break;
      }
      case 'base64': {
        if (typeof value !== 'string' || !BASE64_RE.test(value)) {
          errors.push(fieldError(name, 'INVALID_TYPE', `Field "${name}" must be a base64-encoded string`));
          continue;
        }
        break;
      }
      case 'enum': {
        // Enum check handled below
        break;
      }
      case 'any':
        break;
    }

    // ── Constraints ───────────────────────────
    const num = parseNumber(value);

    if (field.min_length !== undefined && typeof value === 'string' && value.length < field.min_length) {
      errors.push(fieldError(name, 'MIN_LENGTH', `Field "${name}" must be at least ${field.min_length} characters`));
    }
    if (field.max_length !== undefined && typeof value === 'string' && value.length > field.max_length) {
      errors.push(fieldError(name, 'MAX_LENGTH', `Field "${name}" must be at most ${field.max_length} characters`));
    }
    if (field.min !== undefined && num !== null && num < field.min) {
      errors.push(fieldError(name, 'MIN', `Field "${name}" must be >= ${field.min}`));
    }
    if (field.max !== undefined && num !== null && num > field.max) {
      errors.push(fieldError(name, 'MAX', `Field "${name}" must be <= ${field.max}`));
    }
    if (field.gt !== undefined && num !== null && num <= field.gt) {
      errors.push(fieldError(name, 'GT', `Field "${name}" must be > ${field.gt}`));
    }
    if (field.gte !== undefined && num !== null && num < field.gte) {
      errors.push(fieldError(name, 'GTE', `Field "${name}" must be >= ${field.gte}`));
    }

    // ── Format ────────────────────────────────
    if (field.format === 'YYYY-MM-DD' && typeof value === 'string' && !DATE_YYYYMMDD.test(value)) {
      errors.push(fieldError(name, 'INVALID_FORMAT', `Field "${name}" must be in format YYYY-MM-DD`));
    }

    // ── Enum ──────────────────────────────────
    if (field.type === 'enum' && field.values) {
      if (!field.values.includes(String(value))) {
        errors.push(
          fieldError(
            name,
            'INVALID_ENUM',
            `Field "${name}" must be one of: ${field.values.join(', ')}. Got: "${value}"`,
          ),
        );
      }
    }

    // ── must_be ───────────────────────────────
    if (field.must_be) {
      if (field.must_be === 'future' && !isFuture(value)) {
        errors.push(fieldError(name, 'MUST_BE_FUTURE', `Field "${name}" must be a future date`));
      } else if (field.must_be === 'past' && !isPast(value)) {
        errors.push(fieldError(name, 'MUST_BE_PAST', `Field "${name}" must be a past date`));
      } else if (field.must_be === 'today' && !isToday(value)) {
        errors.push(fieldError(name, 'MUST_BE_TODAY', `Field "${name}" must be today's date`));
      }
    }

    // ── must_contain ──────────────────────────
    if (field.must_contain && typeof value === 'string' && !value.includes(field.must_contain)) {
      errors.push(fieldError(name, 'MUST_CONTAIN', `Field "${name}" must contain "${field.must_contain}"`));
    }

    // ── human_confirmation_if ─────────────────
    if (field.human_confirmation_if && num !== null) {
      const cond = field.human_confirmation_if;
      let triggered = false;
      let triggerDesc = '';

      if (cond.gt !== undefined && num > cond.gt) { triggered = true; triggerDesc = `${name} > ${cond.gt}`; }
      if (cond.gte !== undefined && num >= cond.gte) { triggered = true; triggerDesc = `${name} >= ${cond.gte}`; }
      if (cond.lt !== undefined && num < cond.lt) { triggered = true; triggerDesc = `${name} < ${cond.lt}`; }
      if (cond.lte !== undefined && num <= cond.lte) { triggered = true; triggerDesc = `${name} <= ${cond.lte}`; }
      if (cond.eq !== undefined && value === cond.eq) { triggered = true; triggerDesc = `${name} = ${cond.eq}`; }

      if (triggered) {
        needsHumanConfirmation = true;
        confirmationReasons.push(`Value requires confirmation: ${triggerDesc}`);
      }
    }
  }

  // Also flag if operation itself requires confirmation
  if (
    operation.autonomy_policy === 'require_explicit_confirmation' ||
    operation.human_confirmation?.required
  ) {
    needsHumanConfirmation = true;
    confirmationReasons.push(`Operation "${operation.name}" always requires human confirmation`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    needsHumanConfirmation,
    confirmationReasons,
    riskLevel: operation.risk_level,
    autonomyPolicy: operation.autonomy_policy,
  };
}
