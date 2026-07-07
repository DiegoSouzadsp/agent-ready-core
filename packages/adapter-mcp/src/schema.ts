import { z } from 'zod';
import { getInputFields } from '@agent-ready/core';
import type { InputField, Operation } from '@agent-ready/core';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * Map one ARS field type to a Zod type.
 *
 * Deliberately excludes numeric/length constraints (gt, gte, min, max, min_length,
 * max_length): the MCP SDK validates `inputSchema` before invoking the tool handler,
 * so a Zod-level rejection would become a protocol error this package cannot reshape
 * into ARS's `validation_error` signpost. All constraint enforcement stays inside
 * `pipeline.ts`, via ARS's own `validateInput()`.
 */
function fieldTypeToZod(field: InputField): z.ZodTypeAny {
  switch (field.type) {
    case 'string':
      return z.string();
    case 'int':
      return z.number().int();
    case 'decimal':
      return z.number();
    case 'bool':
      return z.boolean();
    case 'date':
      return z.string();
    case 'datetime':
      return z.string();
    case 'enum':
      return field.values && field.values.length > 0
        ? z.enum(field.values as [string, ...string[]])
        : z.string();
    case 'base64':
      return z.string();
    case 'any':
      return z.any();
    default:
      return z.any();
  }
}

/**
 * Build the constraint summary ("bula") of one field, exposed to the agent via
 * the field's MCP-visible description. Constraints are deliberately NOT encoded
 * in the Zod schema (see fieldTypeToZod) so violations surface as ARS
 * `validation_error` signposts instead of protocol errors — this summary is how
 * the agent learns the rules BEFORE calling, rather than by being corrected.
 */
export function fieldConstraintSummary(field: InputField): string {
  const parts: string[] = [];

  if (field.required) parts.push('required');
  if (field.required_if) {
    parts.push(
      `required when ${field.required_if.field} = ${JSON.stringify(field.required_if.value)}`,
    );
  }
  if (field.format) parts.push(`format ${field.format}`);
  if (field.min !== undefined) parts.push(`min ${field.min}`);
  if (field.max !== undefined) parts.push(`max ${field.max}`);
  if (field.gt !== undefined) parts.push(`must be > ${field.gt}`);
  if (field.gte !== undefined) parts.push(`must be >= ${field.gte}`);
  if (field.min_length !== undefined) parts.push(`min length ${field.min_length}`);
  if (field.max_length !== undefined) parts.push(`max length ${field.max_length}`);
  if (field.must_be) parts.push(`must be a ${field.must_be} date`);
  if (field.must_contain) parts.push(`must contain "${field.must_contain}"`);
  if (field.default !== undefined) parts.push(`default ${JSON.stringify(field.default)}`);
  if (field.infer_from_context) parts.push('inferred from context when omitted');
  if (field.foreign_key) {
    const { table, filter } = field.foreign_key;
    const filterDesc = filter
      ? ` where ${Object.entries(filter)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ')}`
      : '';
    parts.push(`must reference an existing row in "${table}"${filterDesc}`);
  }
  if (field.human_confirmation_if) {
    const c = field.human_confirmation_if;
    const conds: string[] = [];
    if (c.gt !== undefined) conds.push(`> ${c.gt}`);
    if (c.gte !== undefined) conds.push(`>= ${c.gte}`);
    if (c.lt !== undefined) conds.push(`< ${c.lt}`);
    if (c.lte !== undefined) conds.push(`<= ${c.lte}`);
    if (c.eq !== undefined) conds.push(`= ${JSON.stringify(c.eq)}`);
    if (conds.length > 0) {
      parts.push(`triggers human confirmation if value ${conds.join(' or ')}`);
    }
  }

  return parts.join('; ');
}

/**
 * Convert normalized ARS input fields into a raw Zod shape suitable for
 * @modelcontextprotocol/sdk's `registerTool` `inputSchema` (`ZodRawShapeCompat` —
 * confirmed against the installed SDK's `.d.ts`: a plain `Record<string, ZodType>`,
 * not a wrapped `z.object(...)`).
 *
 * Each field's description carries its full constraint summary (`[rules: ...]`)
 * so the agent knows how to fill the field before the first call.
 */
export function inputFieldsToZodShape(fields: InputField[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let zodType = fieldTypeToZod(field);

    const summary = fieldConstraintSummary(field);
    const description = [field.description, summary ? `[rules: ${summary}]` : '']
      .filter(Boolean)
      .join(' ');
    if (description) {
      zodType = zodType.describe(description);
    }
    if (!field.required) {
      zodType = zodType.optional();
    }

    shape[field.name!] = zodType;
  }

  return shape;
}

/** Convenience wrapper: derive the Zod shape directly from an ARS Operation. */
export function operationInputSchema(operation: Operation): Record<string, z.ZodTypeAny> {
  return inputFieldsToZodShape(getInputFields(operation));
}

/**
 * Build the MCP-visible description for an operation, prefixed with its risk
 * level so a calling agent sees the governance stance BEFORE calling the tool —
 * not just after, from a `pending` signpost. `risk_level: confirmation` gets an
 * explicit note that the call will never execute unconfirmed (matches AD-002:
 * the bridge never calls the executor for these). Operations with a field-level
 * `human_confirmation_if` (e.g. an amount threshold) get a conditional note,
 * since that can't be resolved until the actual input is known.
 */
export function operationToolDescription(operation: Operation): string {
  const base = operation.description ?? operation.name;
  const tag = `[risk: ${operation.risk_level}]`;

  if (operation.risk_level === 'confirmation') {
    return `${tag} ${base} — always requires explicit human confirmation; this call returns a pending response and never executes on its own.`;
  }

  const hasConditionalConfirmation = getInputFields(operation).some(
    (field) => field.human_confirmation_if !== undefined,
  );
  if (hasConditionalConfirmation) {
    return `${tag} ${base} — may require human confirmation depending on input values.`;
  }

  return `${tag} ${base}`;
}

/**
 * Build MCP tool annotations from an operation's risk level. Annotations are
 * hints only (per the SDK's own docs — clients should not make trust decisions
 * from them), so this is a supplement to operationToolDescription()'s text, not
 * a replacement for it.
 */
export function operationToolAnnotations(operation: Operation): ToolAnnotations | undefined {
  if (operation.risk_level === 'free') return { readOnlyHint: true };
  if (operation.risk_level === 'confirmation') return { destructiveHint: true };
  return undefined;
}
