import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Path to the compiled CLI entry point
const cliPath = path.resolve(__dirname, '../dist/index.js');
// Test fixtures
const goodSchema = path.resolve(__dirname, '../../../docs/schemas/familyos/financeiro.yml');
const badSchema = path.resolve(__dirname, '../../../docs/bad_schema.yml');

// Helper to run the CLI command
async function runCli(args: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(`node ${cliPath} ${args}`);
    return { stdout, stderr, code: 0 };
  } catch (err: any) {
    return { stdout: err.stdout, stderr: err.stderr, code: err.code };
  }
}

describe('CLI Commands', () => {
  beforeAll(async () => {
    // Ensure the bad schema exists for testing
    // It should have been created manually in the docs folder.
  });

  describe('ars validate', () => {
    it('passes for a valid schema', async () => {
      const { stdout, code } = await runCli(`validate "${goodSchema}"`);
      expect(code).toBe(0);
      expect(stdout).toContain('Schema is valid!');
      expect(stdout).toContain('financeiro');
    });

    it('fails for an invalid schema (syntax error)', async () => {
      const { stderr, code } = await runCli(`validate "${badSchema}"`);
      expect(code).toBe(1);
      expect(stderr).toContain('Schema Validation Error');
      // YAML parser should throw a syntax-related message
    });

    it('fails if file is not found', async () => {
      const { stderr, code } = await runCli(`validate "docs/does_not_exist.yml"`);
      expect(code).toBe(1);
      expect(stderr).toContain('File not found');
    });
  });

  describe('ars list', () => {
    it('lists all operations in a valid schema', async () => {
      const { stdout, code } = await runCli(`list "${goodSchema}"`);
      expect(code).toBe(0);
      expect(stdout).toContain('Operations in module \'financeiro\'');
      expect(stdout).toContain('OP-FIN-01');
      expect(stdout).toContain('registrar_gasto');
      expect(stdout).toContain('Validated');
    });
  });

  describe('ars risk', () => {
    it('prints the risk matrix correctly', async () => {
      const { stdout, code } = await runCli(`risk "${goodSchema}"`);
      expect(code).toBe(0);
      expect(stdout).toContain('Autonomy Matrix');
      expect(stdout).toContain('CONFIRMATION');
      expect(stdout).toContain('deletar_gasto');
      expect(stdout).toContain('VALIDATED');
      expect(stdout).toContain('registrar_gasto');
    });
  });

  describe('ars test', () => {
    it('returns validation errors for invalid input', async () => {
      const windowsSafePayload = `"{ \\"descricao\\": \\"fe\\", \\"valor\\": -10 }"`;
      const { stdout, code } = await runCli(`test "${goodSchema}" registrar_gasto --input ${windowsSafePayload}`);
      expect(code).toBe(0); // the CLI command successfully runs (it catches validation errors and prints them, without exit 1)
      expect(stdout).toContain('Validation Failed');
      expect(stdout).toContain('Signpost Result');
      expect(stdout).toContain('MIN_LENGTH');
      expect(stdout).toContain('GT');
    });

    it('returns success for valid input', async () => {
      const windowsSafePayload = `"{ \\"descricao\\": \\"uber\\", \\"valor\\": 50, \\"categoria_id\\": 2, \\"membro_id\\": 1 }"`;
      const { stdout, code } = await runCli(`test "${goodSchema}" registrar_gasto --input ${windowsSafePayload}`);
      expect(code).toBe(0);
      expect(stdout).toContain('Validation Passed!');
    });

    it('requires human confirmation if conditions met', async () => {
      const windowsSafePayload = `"{ \\"descricao\\": \\"tv_samsung\\", \\"valor\\": 600, \\"categoria_id\\": 5, \\"membro_id\\": 1 }"`;
      const { stdout, code } = await runCli(`test "${goodSchema}" registrar_gasto --input ${windowsSafePayload}`);
      expect(code).toBe(0);
      expect(stdout).toContain('Requires Human Confirmation');
    });

    it('fails if operation not found', async () => {
      const { stderr, code } = await runCli(`test "${goodSchema}" fake_op`);
      expect(code).toBe(1);
      expect(stderr).toContain('Operation \'fake_op\' not found');
    });
  });
});
