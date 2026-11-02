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
    expect(spawnSync('node', [cliPath, 'init', schemaDir]).status).toBe(0);
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

// why: each test spawns node 2-4 times and a loaded machine overruns the default 5 s.
describe('ars agent init', { timeout: 60000 }, () => {
  it('agent init writes a valid commented policy', async () => {
    const { loadAgentPolicyFromFile } = await import('@agent-ready/core');
    const dir = tmpDir();
    const r = spawnSync('node', [cliPath, 'agent', 'init', dir], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const file = path.join(dir, 'agent-policy.yml');
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('#');
    for (const key of ['agent_policy', 'autonomy', 'execute_up_to', 'ask_up_to', 'systems']) expect(text).toContain(key);
    expect(() => loadAgentPolicyFromFile(file)).not.toThrow();
    expect(r.stdout).toContain('Next:');
    expect(r.stdout).toContain('--agent-policy');
  });

  it('agent init refuses overwrite without force', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'agent-policy.yml');
    fs.writeFileSync(file, 'custom: true\n');
    const refused = spawnSync('node', [cliPath, 'agent', 'init', dir], { encoding: 'utf8' });
    expect(refused.status).toBe(1);
    expect(fs.readFileSync(file, 'utf8')).toBe('custom: true\n');
    const forced = spawnSync('node', [cliPath, 'agent', 'init', dir, '--force'], { encoding: 'utf8' });
    expect(forced.status).toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toContain('agent_policy: "1.0"');
  });
});

// why: each test spawns node 2-4 times and a loaded machine overruns the default 5 s.
describe('ars hooks export --agent-policy', { timeout: 60000 }, () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '__fixtures__/claude-code-pretooluse.json'), 'utf8'),
  );
  const BASE = 'agent_policy: "1.0"\nname: bot\nautonomy:\n  execute_up_to: validated\n  ask_up_to: contextual\n';

  function exportWith(policyYaml: string, server = 's', extra: string[] = []) {
    const schemaDir = tmpDir();
    expect(spawnSync('node', [cliPath, 'init', schemaDir]).status).toBe(0);
    const policyFile = path.join(tmpDir(), 'agent-policy.yml');
    fs.writeFileSync(policyFile, policyYaml);
    const out = tmpDir();
    const r = spawnSync('node', [
      cliPath, 'hooks', 'export', path.join(schemaDir, 'agent-ready.yml'),
      '--target', 'claude-code', '--server', server, '--out', out, '--agent-policy', policyFile, ...extra,
    ], { encoding: 'utf8' });
    return { r, out, script: path.join(out, 'ars-pretooluse.mjs') };
  }

  function runHook(script: string, toolName: string, raw?: string) {
    const r = spawnSync('node', [script], {
      input: raw ?? JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: { ticket_id: 1 } }),
      encoding: 'utf8',
    });
    return { status: r.status, stdout: r.stdout.trim() };
  }
  const decisionOf = (script: string, op: string, server = 's') =>
    JSON.parse(runHook(script, `mcp__${server}__${op}`).stdout).hookSpecificOutput;

  it('hook embeds resolved decisions per operation', () => {
    const { r, script } = exportWith(BASE);
    expect(r.status).toBe(0);
    expect(decisionOf(script, 'list_tickets').permissionDecision).toBe('allow');
    expect(decisionOf(script, 'create_ticket').permissionDecision).toBe('allow');
    expect(decisionOf(script, 'assign_ticket').permissionDecision).toBe('ask');
    expect(decisionOf(script, 'delete_ticket').permissionDecision).toBe('deny');
  });

  it('deny reason names profile operation risk and ceiling', () => {
    const { script } = exportWith(BASE);
    const out = decisionOf(script, 'delete_ticket');
    expect(out.hookEventName).toBe('PreToolUse');
    const reason: string = out.permissionDecisionReason;
    for (const part of ['bot', 'delete', 'confirmation', 'validated', 'contextual']) expect(reason).toContain(part);
  });

  it('ask reason for non confirmation risk names profile and risk', () => {
    const { script } = exportWith(BASE);
    const reason: string = decisionOf(script, 'assign_ticket').permissionDecisionReason;
    expect(reason).toContain('bot');
    expect(reason).toContain('contextual');
    const plain = tmpDir();
    const schemaDir = tmpDir();
    expect(spawnSync('node', [cliPath, 'init', schemaDir]).status).toBe(0);
    expect(spawnSync('node', [cliPath, 'hooks', 'export', path.join(schemaDir, 'agent-ready.yml'), '--target', 'claude-code', '--server', 's', '--out', plain]).status).toBe(0);
    const noPolicy = decisionOf(path.join(plain, 'ars-pretooluse.mjs'), 'delete_ticket');
    expect(noPolicy.permissionDecision).toBe('ask');
    expect(noPolicy.permissionDecisionReason).not.toContain('agent policy');
  });

  it('policy exceptions and system key reach the generated hook', () => {
    const yaml = BASE + 'systems:\n  s:\n    execute_up_to: contextual\n    operations:\n      list_tickets: deny\n      delete_ticket: allow\n';
    const forS = exportWith(yaml, 's');
    expect(decisionOf(forS.script, 'list_tickets').permissionDecision).toBe('deny');
    expect(decisionOf(forS.script, 'delete_ticket').permissionDecision).toBe('ask');
    expect(decisionOf(forS.script, 'assign_ticket').permissionDecision).toBe('allow');
    const forT = exportWith(yaml, 't');
    expect(decisionOf(forT.script, 'assign_ticket', 't').permissionDecision).toBe('ask');
  });

  it('system flag picks the policy key independently of the server prefix', () => {
    const yaml = BASE + 'systems:\n  tickets:\n    operations:\n      list_tickets: deny\n';
    const withSystem = exportWith(yaml, 's', ['--system', 'tickets']);
    expect(withSystem.r.status).toBe(0);
    expect(withSystem.r.stderr).not.toContain('no entry');
    expect(decisionOf(withSystem.script, 'list_tickets').permissionDecision).toBe('deny');
    const withoutSystem = exportWith(yaml, 's');
    expect(withoutSystem.r.status).toBe(0);
    expect(decisionOf(withoutSystem.script, 'list_tickets').permissionDecision).toBe('allow');
  });

  it('warns when no systems key matches the resolved system', () => {
    const yaml = BASE + 'systems:\n  tickets:\n    execute_up_to: contextual\n';
    const r = exportWith(yaml, 's');
    expect(r.r.status).toBe(0);
    expect(r.r.stderr).toContain('tickets');
    expect(r.r.stderr).toContain("'s'");
    const quiet = exportWith(BASE, 's');
    expect(quiet.r.stderr).not.toContain('no entry');
  });

  it('hooks export with a bad policy fails and writes nothing', () => {
    const schemaDir = tmpDir();
    expect(spawnSync('node', [cliPath, 'init', schemaDir]).status).toBe(0);
    const schemaFile = path.join(schemaDir, 'agent-ready.yml');
    const out1 = tmpDir();
    const missing = path.join(tmpDir(), 'nope.yml');
    const r1 = spawnSync('node', [cliPath, 'hooks', 'export', schemaFile, '--target', 'claude-code', '--out', out1, '--agent-policy', missing], { encoding: 'utf8' });
    expect(r1.status).toBe(1);
    expect(r1.stderr).toContain('nope.yml');
    expect(fs.readdirSync(out1)).toEqual([]);
    const bad = exportWith('agent_policy: "1.0"\nname: bot\nautonomy:\n  execute_up_to: confirmation\n  ask_up_to: confirmation\n');
    expect(bad.r.status).toBe(1);
    expect(bad.r.stderr).toContain('confirmation');
    expect(fs.readdirSync(bad.out)).toEqual([]);
  });

  it('hook with policy ignores foreign and unknown events', () => {
    const { script } = exportWith(BASE);
    for (const tool of ['mcp__other__list_tickets', 'Bash', 'mcp__s__nope']) {
      const res = runHook(script, tool);
      expect(res.status).toBe(0);
      expect(res.stdout).toBe('');
    }
    const invalid = runHook(script, '', '{not json');
    expect(invalid.status).toBe(0);
    expect(invalid.stdout).toBe('');
  });

  it('fixture covers allow ask and deny outputs', () => {
    const { script } = exportWith(BASE);
    const run = (op: string) => JSON.parse(runHook(script, `mcp__s__${op}`).stdout);
    const keys = (o: any) => Object.keys(o.hookSpecificOutput).sort();
    expect(run('list_tickets')).toEqual(fixture.allow_output);
    expect(keys(run('assign_ticket'))).toEqual(keys(fixture.ask_output));
    const deny = run('delete_ticket');
    expect(keys(deny)).toEqual(keys(fixture.deny_output));
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(deny.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  });
});

describe('init --from-openapi', () => {
  const fixtureFile = path.resolve(__dirname, '__fixtures__/petstore-mini.yaml');
  const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ars-oai-'));
  const gen = async (doc: any) => (await import('./openapi-init.js')).convertOpenApi(doc);
  const loadFixture = async () => (await import('./openapi-init.js')).loadOpenApiSource(fixtureFile);
  const opsOf = async (doc?: any) => {
    const { parse } = await import('yaml');
    const r = await gen(doc ?? (await loadFixture()));
    const parsed = parse(r.yaml);
    return { r, ops: Object.fromEntries(parsed.operations.map((o: any) => [o.name, o])) as Record<string, any> };
  };

  it('generates the 8 fixture operations with unique ids and a loadable schema', async () => {
    const { r, ops } = await opsOf();
    expect(r.operations).toEqual(['listPets', 'createPet', 'get_pets_petid', 'updatePet', 'deletePet', 'renamePet', 'listOwners', 'getOwner']);
    const ids = Object.values(ops).map((o: any) => o.id);
    expect(new Set(ids).size).toBe(8);
    const { AgentReady } = await import('@agent-ready/core');
    expect(() => AgentReady.fromYAML(r.yaml)).not.toThrow();
    expect(ops.listPets.description).toBe('List pets');
  });

  it('maps risk by HTTP method', async () => {
    const { ops } = await opsOf();
    for (const n of ['listPets', 'get_pets_petid', 'listOwners', 'getOwner']) {
      expect([ops[n].risk_level, ops[n].autonomy_policy]).toEqual(['free', 'execute_immediately']);
    }
    expect([ops.createPet.risk_level, ops.createPet.autonomy_policy]).toEqual(['validated', 'execute_after_validation']);
    expect(ops.updatePet.risk_level).toBe('contextual');
    expect(ops.renamePet.risk_level).toBe('contextual');
    expect(ops.deletePet.risk_level).toBe('confirmation');
    expect(ops.deletePet.human_confirmation.required).toBe(true);
    expect(ops.deletePet.human_confirmation.message_template).toBeTruthy();
  });

  it('maps types, enums and required as a map', async () => {
    const { ops } = await opsOf();
    const c = ops.createPet.input_schema;
    expect(Array.isArray(c)).toBe(false);
    expect(c.name).toMatchObject({ type: 'string', required: true });
    expect(c.tag.type).toBe('string');
    expect(c.birthday.type).toBe('date');
    expect(c.weight.type).toBe('decimal');
    expect(c.vaccinated.type).toBe('bool');
    expect(c.registered_at.type).toBe('datetime');
    expect(ops.listPets.input_schema.status).toMatchObject({ type: 'enum', values: ['available', 'pending', 'sold'], required: false });
    expect(ops.listPets.input_schema.limit.type).toBe('int');
    expect(ops.get_pets_petid.input_schema.petId).toMatchObject({ type: 'int', required: true });
  });

  it('resolves local $ref and merges path param with body properties', async () => {
    const { r, ops } = await opsOf();
    expect(Object.keys(ops.updatePet.input_schema)).toEqual(['petId', 'name', 'tag', 'birthday', 'weight', 'vaccinated', 'registered_at']);
    expect(r.yaml).not.toContain('$ref');
  });

  it('declares summary only for array GETs', async () => {
    const { ops } = await opsOf();
    expect(ops.listPets.response_strategy).toEqual({ mode: 'summary', summary_fields: ['id', 'name', 'tag'] });
    expect(ops.listOwners.response_strategy).toEqual({ mode: 'summary', summary_fields: ['id', 'name', 'email'] });
    for (const n of ['get_pets_petid', 'getOwner', 'createPet', 'updatePet', 'deletePet', 'renamePet']) {
      expect(ops[n].response_strategy).toBeUndefined();
    }
    const bare = await gen({
      openapi: '3.0.0', info: { title: 'x' },
      paths: { '/a': { get: { responses: { '200': { content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } } } } },
    });
    expect(bare.yaml).toContain('mode: summary');
    expect(bare.yaml).not.toContain('summary_fields');
  });

  it('warns on external $ref without failing and keeps the YAML valid', async () => {
    const r = await gen({
      openapi: '3.0.0', info: { title: 'x' },
      paths: { '/a': { post: { operationId: 'a', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { ext: { $ref: './other.yaml#/X' }, ok: { type: 'string' } } } } } } } } },
    });
    expect(r.warnings.join(' ')).toContain('./other.yaml#/X');
    expect(r.yaml).not.toContain('$ref');
  });

  it('maps byte to base64 and untyped/object/array to any', async () => {
    const r = await gen({
      openapi: '3.0.0', info: { title: 'x' },
      paths: { '/a': { post: { operationId: 'a', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
        b: { type: 'string', format: 'byte' }, o: { type: 'object' }, l: { type: 'array' }, u: {},
      } } } } } } } },
    });
    const { parse } = await import('yaml');
    const f = parse(r.yaml).operations[0].input_schema;
    expect([f.b.type, f.o.type, f.l.type, f.u.type]).toEqual(['base64', 'any', 'any', 'any']);
  });

  it('fails without writing for invalid inputs', async () => {
    const dir = mkTmp();
    const cases: Record<string, string> = {
      'swagger.yaml': 'swagger: "2.0"\ninfo: {title: x}\npaths: {}\n',
      'garbage.txt': 'just: [unclosed',
      'empty.yaml': 'openapi: 3.0.0\ninfo: {title: x}\npaths: {}\n',
      'dup.yaml': 'openapi: 3.0.0\ninfo: {title: x}\npaths:\n  /a:\n    get: {operationId: same}\n  /b:\n    get: {operationId: same}\n',
    };
    for (const [file, content] of Object.entries(cases)) {
      const src = path.join(dir, file);
      fs.writeFileSync(src, content);
      const out = path.join(dir, `out-${file}`);
      const r = await runCli(`init --from-openapi "${src}" "${out}"`);
      expect(r.code, file).toBe(1);
      expect(r.stderr.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(out, 'agent-ready.yml')), file).toBe(false);
    }
    const out = path.join(dir, 'out-missing');
    const r = await runCli(`init --from-openapi "${path.join(dir, 'nope.yaml')}" "${out}"`);
    expect(r.code).toBe(1);
    expect(fs.existsSync(path.join(out, 'agent-ready.yml'))).toBe(false);
  });

  it('CLI generates, validates, lists, accepts JSON, and honours --force', async () => {
    const dir = mkTmp();
    const r = await runCli(`init --from-openapi "${fixtureFile}" "${dir}"`);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Next: ars validate');
    const target = path.join(dir, 'agent-ready.yml');
    expect((await runCli(`validate "${target}"`)).code).toBe(0);
    const list = await runCli(`list "${target}"`);
    for (const n of ['listPets', 'createPet', 'get_pets_petid', 'updatePet', 'deletePet', 'renamePet', 'listOwners', 'getOwner']) {
      expect(list.stdout).toContain(n);
    }
    const before = fs.readFileSync(target);
    const again = await runCli(`init --from-openapi "${fixtureFile}" "${dir}"`);
    expect(again.code).toBe(1);
    expect(fs.readFileSync(target).equals(before)).toBe(true);
    fs.writeFileSync(target, 'stale');
    expect((await runCli(`init --from-openapi "${fixtureFile}" "${dir}" --force`)).code).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toContain('listPets');

    const { parse } = await import('yaml');
    const jsonFile = path.join(dir, 'spec.json');
    fs.writeFileSync(jsonFile, JSON.stringify(parse(fs.readFileSync(fixtureFile, 'utf8'))));
    const dir2 = mkTmp();
    expect((await runCli(`init --from-openapi "${jsonFile}" "${dir2}"`)).code).toBe(0);
    const strip = (s: string) => s.replace(/updated_at:.*/, '');
    expect(strip(fs.readFileSync(path.join(dir2, 'agent-ready.yml'), 'utf8'))).toBe(strip(fs.readFileSync(target, 'utf8')));
  });

  it('loads from an http URL like a file and reports HTTP status failures', async () => {
    const http = await import('node:http');
    const body = fs.readFileSync(fixtureFile);
    const server = http.createServer((req, res) => {
      if (req.url === '/openapi.yaml') {
        res.writeHead(200, { 'content-type': 'text/yaml' });
        res.end(body);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port;
    try {
      const { loadOpenApiSource, convertOpenApi } = await import('./openapi-init.js');
      const viaUrl = convertOpenApi(await loadOpenApiSource(`http://127.0.0.1:${port}/openapi.yaml`));
      const viaFile = convertOpenApi(await loadOpenApiSource(fixtureFile));
      expect(viaUrl.operations).toEqual(viaFile.operations);
      await expect(loadOpenApiSource(`http://127.0.0.1:${port}/missing.yaml`)).rejects.toThrow(/404/);
      const dir = mkTmp();
      const r = await runCli(`init --from-openapi http://127.0.0.1:${port}/openapi.yaml "${dir}"`);
      expect(r.code).toBe(0);
      expect(fs.existsSync(path.join(dir, 'agent-ready.yml'))).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe('init --from-openapi edge cases', () => {
  const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ars-oai-'));

  it('terminates on a cyclic $ref, warns, and emits valid YAML without $ref', async () => {
    const dir = mkTmp();
    const src = path.join(dir, 'cyclic.yaml');
    fs.writeFileSync(src, [
      'openapi: 3.0.0',
      'info: {title: cyc}',
      'paths:',
      '  /a:',
      '    post:',
      '      operationId: makeA',
      '      requestBody:',
      '        content:',
      '          application/json:',
      '            schema:',
      '              type: object',
      '              properties:',
      '                loop: {$ref: "#/components/schemas/A"}',
      '                ok: {type: string}',
      'components:',
      '  schemas:',
      '    A: {$ref: "#/components/schemas/A"}',
      '',
    ].join('\n'));
    const out = path.join(dir, 'out');
    const r = await runCli(`init --from-openapi "${src}" "${out}"`);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('too deep or cyclic');
    const text = fs.readFileSync(path.join(out, 'agent-ready.yml'), 'utf8');
    expect(text).not.toContain('$ref');
    expect((await runCli(`validate "${path.join(out, 'agent-ready.yml')}"`)).code).toBe(0);
  });

  it('rejects a document without paths and writes nothing', async () => {
    const dir = mkTmp();
    const src = path.join(dir, 'nopaths.yaml');
    fs.writeFileSync(src, 'openapi: 3.0.0\ninfo: {title: x}\n');
    const { convertOpenApi, OpenApiImportError } = await import('./openapi-init.js');
    expect(() => convertOpenApi({ openapi: '3.0.0', info: { title: 'x' } })).toThrow(OpenApiImportError);
    expect(() => convertOpenApi({ openapi: '3.0.0', info: { title: 'x' } })).toThrow(/no operations found/);
    const out = path.join(dir, 'out');
    const r = await runCli(`init --from-openapi "${src}" "${out}"`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no operations found');
    expect(fs.existsSync(path.join(out, 'agent-ready.yml'))).toBe(false);
  });
});
