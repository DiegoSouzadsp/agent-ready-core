import { z } from 'zod';
import { getInputFields } from '@agent-ready/core';
import type { InputField, Operation } from '@agent-ready/core';

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
 * Convert normalized ARS input fields into a raw Zod shape suitable for
 * @modelcontextprotocol/sdk's `registerTool` `inputSchema` (`ZodRawShapeCompat` —
 * confirmed against the installed SDK's `.d.ts`: a plain `Record<string, ZodType>`,
 * not a wrapped `z.object(...)`).
 */
export function inputFieldsToZodShape(fields: InputField[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let zodType = fieldTypeToZod(field);

    if (field.description) {
      zodType = zodType.describe(field.description);
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
