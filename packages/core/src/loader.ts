import { parse } from 'yaml';
import type { AgentReadySchema, Operation, InputField } from './types.js';

/**
 * Parse a YAML string into a typed AgentReadySchema object.
 * Validates basic structure and normalizes input_schema fields.
 *
 * @throws {Error} If YAML is invalid or missing required fields
 */
export function loadSchema(yamlContent: string): AgentReadySchema {
  let raw: unknown;
  try {
    raw = parse(yamlContent);
  } catch (err) {
    throw new Error(`[agent-ready] Failed to parse YAML: ${(err as Error).message}`);
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('[agent-ready] Schema must be a YAML object');
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.schema_version) {
    throw new Error('[agent-ready] Missing required field: schema_version');
  }
  if (!obj.module) {
    throw new Error('[agent-ready] Missing required field: module');
  }
  if (!Array.isArray(obj.operations)) {
    throw new Error('[agent-ready] Field "operations" must be an array');
  }

  // Normalize each operation's input_schema from map → internal format
  const operations = (obj.operations as Record<string, unknown>[]).map((op) => {
    if (op.input_schema && !Array.isArray(op.input_schema) && typeof op.input_schema === 'object') {
      // Keep as Record<string, InputField> — normalizeInputSchema() converts to array
      return op as unknown as Operation;
    }
    return op as unknown as Operation;
  });

  return {
    schema_version: String(obj.schema_version),
    module: String(obj.module),
    system: obj.system ? String(obj.system) : undefined,
    updated_at: obj.updated_at ? String(obj.updated_at) : undefined,
    operations,
  };
}

/**
 * Load and parse a schema from a YAML file path.
 *
 * @param filePath - Absolute or relative path to the .yml / .yaml file
 */
export async function loadSchemaFromFile(filePath: string): Promise<AgentReadySchema> {
  let content: string;
  try {
    const { readFile } = await import('node:fs/promises');
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`[agent-ready] Cannot read schema file "${filePath}": ${(err as Error).message}`);
  }
  return loadSchema(content);
}

/**
 * Merge multiple schemas into one.
 * Combines their operations. Throws on duplicate operation ids or names.
 *
 * @param schemas - Two or more AgentReadySchema objects
 */
export function mergeSchemas(...schemas: AgentReadySchema[]): AgentReadySchema {
  if (schemas.length === 0) throw new Error('[agent-ready] mergeSchemas requires at least one schema');

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const allOperations: Operation[] = [];

  for (const schema of schemas) {
    for (const op of schema.operations) {
      if (seenIds.has(op.id)) {
        throw new Error(`[agent-ready] Duplicate operation id: "${op.id}"`);
      }
      if (seenNames.has(op.name)) {
        throw new Error(`[agent-ready] Duplicate operation name: "${op.name}"`);
      }
      seenIds.add(op.id);
      seenNames.add(op.name);
      allOperations.push(op);
    }
  }

  const [first] = schemas;
  return {
    schema_version: first.schema_version,
    module: schemas.map((s) => s.module).join('+'),
    system: first.system,
    updated_at: new Date().toISOString().split('T')[0],
    operations: allOperations,
  };
}

/**
 * Find an operation by its name or id.
 *
 * @param schema - The loaded schema
 * @param nameOrId - Operation name (e.g. 'registrar_gasto') or id (e.g. 'OP-FIN-01')
 */
export function findOperation(schema: AgentReadySchema, nameOrId: string): Operation | undefined {
  return schema.operations.find(
    (op) => op.name === nameOrId || op.id === nameOrId,
  );
}

/**
 * List all operation names in a schema.
 */
export function listOperations(schema: AgentReadySchema): string[] {
  return schema.operations.map((op) => op.name);
}

/**
 * Normalize the input_schema from YAML map format to an array of InputField,
 * adding the field `name` property from the map key.
 *
 * @example
 * // YAML format:
 * // input_schema:
 * //   valor: { type: decimal, required: true, gt: 0 }
 * //
 * // Normalized:
 * // [{ name: 'valor', type: 'decimal', required: true, gt: 0 }]
 */
export function normalizeInputSchema(
  raw: Record<string, Omit<InputField, 'name'>>,
): InputField[] {
  return Object.entries(raw).map(([name, field]) => ({
    name,
    ...field,
  }));
}

/**
 * Get normalized input fields from an operation's input_schema.
 * Handles both map (from raw YAML) and array (already normalized) formats.
 */
export function getInputFields(operation: Operation): InputField[] {
  const schema = operation.input_schema;
  if (!schema) return [];
  if (Array.isArray(schema)) return schema;
  return normalizeInputSchema(schema as Record<string, Omit<InputField, 'name'>>);
}
