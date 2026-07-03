import { describe, it, expect } from 'vitest';
import { loadSchema, normalizeInputSchema, getInputFields, mergeSchemas, findOperation, listOperations } from '../src/loader.js';

const MINIMAL_SCHEMA = `
schema_version: "0.1"
module: test
operations:
  - id: OP-TEST-01
    name: test_op
    risk_level: free
    autonomy_policy: execute_immediately
    input_schema:
      name:
        type: string
        required: true
      age:
        type: int
        required: false
        default: 18
`;

const SECOND_SCHEMA = `
schema_version: "0.1"
module: other
operations:
  - id: OP-OTHER-01
    name: other_op
    risk_level: validated
    autonomy_policy: execute_after_validation
`;

describe('loader', () => {
  describe('loadSchema', () => {
    it('parses a valid YAML schema', () => {
      const schema = loadSchema(MINIMAL_SCHEMA);
      expect(schema.schema_version).toBe('0.1');
      expect(schema.module).toBe('test');
      expect(schema.operations).toHaveLength(1);
      expect(schema.operations[0].name).toBe('test_op');
    });

    it('throws on invalid YAML', () => {
      expect(() => loadSchema('{ invalid: [yaml')).toThrow('[agent-ready]');
    });

    it('throws if schema_version is missing', () => {
      expect(() => loadSchema('module: test\noperations: []')).toThrow('schema_version');
    });

    it('throws if module is missing', () => {
      expect(() => loadSchema('schema_version: "0.1"\noperations: []')).toThrow('module');
    });

    it('throws if operations is not array', () => {
      expect(() => loadSchema('schema_version: "0.1"\nmodule: test\noperations: not-array')).toThrow('operations');
    });
  });

  describe('normalizeInputSchema', () => {
    it('converts map to array with name field', () => {
      const raw = {
        valor: { type: 'decimal' as const, required: true, gt: 0 },
        descricao: { type: 'string' as const, required: true, min_length: 3 },
      };
      const fields = normalizeInputSchema(raw);
      expect(fields).toHaveLength(2);
      expect(fields[0].name).toBe('valor');
      expect(fields[0].type).toBe('decimal');
      expect(fields[0].required).toBe(true);
      expect(fields[1].name).toBe('descricao');
    });
  });

  describe('getInputFields', () => {
    it('returns empty array if no input_schema', () => {
      const schema = loadSchema(MINIMAL_SCHEMA);
      const op = { ...schema.operations[0], input_schema: undefined };
      expect(getInputFields(op)).toEqual([]);
    });

    it('normalizes map format from loaded schema', () => {
      const schema = loadSchema(MINIMAL_SCHEMA);
      const fields = getInputFields(schema.operations[0]);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.every(f => typeof f.name === 'string')).toBe(true);
    });
  });

  describe('findOperation', () => {
    it('finds by name', () => {
      const schema = loadSchema(MINIMAL_SCHEMA);
      const op = findOperation(schema, 'test_op');
      expect(op?.name).toBe('test_op');
    });

    it('finds by id', () => {
      const schema = loadSchema(MINIMAL_SCHEMA);
      const op = findOperation(schema, 'OP-TEST-01');
      expect(op?.id).toBe('OP-TEST-01');
    });

    it('returns undefined if not found', () => {
      const schema = loadSchema(MINIMAL_SCHEMA);
      expect(findOperation(schema, 'nonexistent')).toBeUndefined();
    });
  });

  describe('listOperations', () => {
    it('returns all operation names', () => {
      const schema = loadSchema(MINIMAL_SCHEMA);
      expect(listOperations(schema)).toEqual(['test_op']);
    });
  });

  describe('mergeSchemas', () => {
    it('combines operations from multiple schemas', () => {
      const s1 = loadSchema(MINIMAL_SCHEMA);
      const s2 = loadSchema(SECOND_SCHEMA);
      const merged = mergeSchemas(s1, s2);
      expect(merged.operations).toHaveLength(2);
      expect(listOperations(merged)).toContain('test_op');
      expect(listOperations(merged)).toContain('other_op');
    });

    it('throws on duplicate operation id', () => {
      const s1 = loadSchema(MINIMAL_SCHEMA);
      const s2 = loadSchema(MINIMAL_SCHEMA);
      expect(() => mergeSchemas(s1, s2)).toThrow('Duplicate operation id');
    });

    it('throws if called with no schemas', () => {
      expect(() => mergeSchemas()).toThrow();
    });
  });
});
