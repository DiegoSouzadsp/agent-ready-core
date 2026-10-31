import { describe, it, expect, beforeAll } from 'vitest';
import { exec, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ars-cli-'));
}

describe('ars init', () => {
  it('init creates a valid agent-ready.yml', async () => {
    const dir = tmpDir();
    const { code } = await runCli(`init "${dir}"`);
    expect(code).toBe(0);
    const file = path.join(dir, 'agent-ready.yml');
    expect(fs.existsSync(file)).toBe(true);
    const validated = await runCli(`validate "${file}"`);
    expect(validated.code).toBe(0);
    expect(validated.stdout).toContain('Operations');
  });

  it('init template has one operation per risk level', () => {
    const dir = tmpDir();
    const r = spawnSync('node', [cliPath, 'init', dir]);
    expect(r.status).toBe(0);
    const text = fs.readFileSync(path.join(dir, 'agent-ready.yml'), 'utf8');
    const levels = [...text.matchAll(/^\s+risk_level: (\w+)$/gm)].map((m) => m[1]);
    expect(levels.sort()).toEqual(['confirmation', 'contextual', 'free', 'validated']);
    expect(text).toContain('# Level 1 (free)');
    expect(text).toContain('predicate: sql.query');
    expect(text).toContain('query: "SELECT status');
    expect(text).toContain('mode: summary');
    expect(text).toContain('message_template');
    expect(text).toContain('include_fields');
    expect(text).toContain('foreign_key');
    expect(text).toContain('validation_rules');
  });

  it('init refuses to overwrite without force', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'agent-ready.yml');
    fs.writeFileSync(file, 'custom: true\n');
    const refused = await runCli(`init "${dir}"`);
    expect(refused.code).toBe(1);
    expect(fs.readFileSync(file, 'utf8')).toBe('custom: true\n');
    const forced = await runCli(`init "${dir}" --force`);
    expect(forced.code).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toContain('module: tickets');
  });
});

describe('ars hooks export', () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '__fixtures__/claude-code-pretooluse.json'), 'utf8'),
  );

  function exportHook(server = 's') {
    const schemaDir = tmpDir();
    expect(spawnSync('node', [cliPath, 'init', schemaDir]).status).toBe(0);
    const out = tmpDir();
    const r = spawnSync('node', [
      cliPath, 'hooks', 'export', path.join(schemaDir, 'agent-ready.yml'),
      '--target', 'claude-code', '--server', server, '--out', out,
    ]);
    return { r, out };
  }

  function runHook(script: string, toolName: string, toolInput: Record<string, unknown> = {}) {
    const r = spawnSync('node', [script], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput }),
      encoding: 'utf8',
    });
    return { status: r.status, stdout: r.stdout.trim() };
  }

  it('hooks export prints script and settings snippet', () => {
    const { r, out } = exportHook();
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(out, 'ars-pretooluse.mjs'))).toBe(true);
    const snippet = JSON.parse(fs.readFileSync(path.join(out, 'settings.snippet.json'), 'utf8'));
    expect(snippet.hooks.PreToolUse[0].matcher).toBe('mcp__s__.*');
    const bad = spawnSync('node', [cliPath, 'hooks', 'export', 'x.yml', '--target', 'nope']);
    expect(bad.status).toBe(1);
  });

  it('generated hook decides by risk level', () => {
    const { out } = exportHook();
    const script = path.join(out, 'ars-pretooluse.mjs');
    for (const name of ['list_tickets', 'create_ticket', 'assign_ticket']) {
      const res = runHook(script, `mcp__s__${name}`);
      expect(res.status).toBe(0);
      expect(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision).toBe('allow');
    }
    const ask = runHook(script, 'mcp__s__delete_ticket');
    expect(JSON.parse(ask.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
    for (const unknown of ['mcp__s__nope', 'mcp__other__list_tickets', 'Bash']) {
      const res = runHook(script, unknown);
      expect(res.status).toBe(0);
      expect(res.stdout).toBe('');
    }
  });

  it('hook keeps unresolved placeholders and quotes the script path', () => {
    const schemaDir = tmpDir();
    spawnSync('node', [cliPath, 'init', schemaDir]);
    const out = path.join(tmpDir(), 'with space');
    const r = spawnSync('node', [
      cliPath, 'hooks', 'export', path.join(schemaDir, 'agent-ready.yml'),
      '--target', 'claude-code', '--server', 's', '--out', out,
    ]);
    expect(r.status).toBe(0);
    const snippet = JSON.parse(fs.readFileSync(path.join(out, 'settings.snippet.json'), 'utf8'));
    const cmd: string = snippet.hooks.PreToolUse[0].hooks[0].command;
    expect(cmd).toMatch(/^node ".*with space.*ars-pretooluse\.mjs"$/);
    const res = runHook(path.join(out, 'ars-pretooluse.mjs'), 'mcp__s__delete_ticket');
    expect(JSON.parse(res.stdout).hookSpecificOutput.permissionDecisionReason).toContain('{{ticket_id}}');
  });

  it('hook output matches documented claude code format fixture', () => {
    expect(fixture.source_url).toMatch(/^https:\/\//);
    const { out } = exportHook();
    const script = path.join(out, 'ars-pretooluse.mjs');
    expect(JSON.parse(runHook(script, 'mcp__s__list_tickets').stdout)).toEqual(fixture.allow_output);
    expect(JSON.parse(runHook(script, fixture.input_example.tool_name, fixture.input_example.tool_input).stdout)).toEqual(fixture.ask_output);
    const snippet = JSON.parse(fs.readFileSync(path.join(out, 'settings.snippet.json'), 'utf8'));
    snippet.hooks.PreToolUse[0].hooks[0].command = snippet.hooks.PreToolUse[0].hooks[0].command
      .replace(out.split(path.sep).join('/'), '<OUT>');
    expect(snippet).toEqual(fixture.settings_snippet);
  });
});
