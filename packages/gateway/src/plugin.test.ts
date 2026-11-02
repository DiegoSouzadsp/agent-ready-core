import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlugin, substituteEnv } from './plugin.js';
import { loadAgentPolicySources } from './agent-policies.js';

const REFERENCE_DIR = fileURLToPath(new URL('../plugins/_reference', import.meta.url));
const BROKEN_DIR = fileURLToPath(new URL('../plugins/_broken', import.meta.url));

const FAKE_ENV = {
  REFERENCE_API_URL: 'https://api.example.com',
  REFERENCE_TOKEN: 'secret-token',
};

describe('substituteEnv', () => {
  it('replaces ${VAR} with the env value', () => {
    expect(substituteEnv('${FOO}', { FOO: 'bar' })).toBe('bar');
  });

  it('replaces a missing var with empty string instead of throwing', () => {
    expect(substituteEnv('${MISSING}', {})).toBe('');
  });

  it('leaves plain strings untouched', () => {
    expect(substituteEnv('https://api.example.com', {})).toBe('https://api.example.com');
  });
});

describe('loadPlugin — reference fixture', () => {
  it('loads name, manifest (with env substituted), agent operations and executor specs', async () => {
    const plugin = await loadPlugin(REFERENCE_DIR, FAKE_ENV);

    expect(plugin.name).toBe('reference');
    expect(plugin.dir).toBe(REFERENCE_DIR);
    expect(plugin.manifest.system_base_url).toBe('https://api.example.com');
    expect(plugin.manifest.auth?.service_token).toBe('secret-token');
    expect(plugin.manifest.auth?.mode).toBe('service_token_acting_user');

    expect(plugin.agent.operations.sort()).toEqual(['criar_item', 'listar_itens']);

    expect(plugin.executorSpecs.listar_itens).toEqual({
      method: 'GET',
      path: '/api/items',
      query: { q: '{{busca}}', limit: '{{limite}}' },
    });
    expect(plugin.executorSpecs.criar_item).toEqual({
      method: 'POST',
      path: '/api/items',
      body_from_input: true,
    });
  });

  it('substitutes an unset env var as empty string on a non-required field, without throwing', async () => {
    const plugin = await loadPlugin(REFERENCE_DIR, { REFERENCE_API_URL: 'https://api.example.com' });
    expect(plugin.manifest.system_base_url).toBe('https://api.example.com');
    expect(plugin.manifest.auth?.service_token).toBe('');
  });
});

describe('loadPlugin — errors', () => {
  it('throws a clear error for a non-existent directory', async () => {
    await expect(loadPlugin('D:/no/such/plugin/dir', FAKE_ENV)).rejects.toThrow(/directory not found/);
  });

  it('throws a clear error when executors.yml is missing', async () => {
    await expect(loadPlugin(BROKEN_DIR, FAKE_ENV)).rejects.toThrow(/executors\.yml/);
  });
});

describe('loadPlugin — signing_secret', () => {
  it('signing_secret is loaded and env-substituted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ars-sign-'));
    try {
      await cp(REFERENCE_DIR, dir, { recursive: true });
      await writeFile(
        join(dir, 'plugin.yml'),
        'plugin: reference\nsystem_base_url: https://api.example.com\nauth:\n  service_token: t\n  signing_secret: ${SIGNING_ENV}\n',
      );
      const plugin = await loadPlugin(dir, { SIGNING_ENV: 'from-env' });
      expect(plugin.manifest.auth?.signing_secret).toBe('from-env');
      const reference = await loadPlugin(REFERENCE_DIR, FAKE_ENV);
      expect(reference.manifest.auth?.signing_secret).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('loadPlugin — invalid manifests', () => {
  async function fixture(files: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), 'ars-bad-'));
    await cp(REFERENCE_DIR, dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
    return dir;
  }
  const BASE = 'plugin: reference\nsystem_base_url: https://api.example.com\n';

  it('names the missing plugin field', async () => {
    const dir = await fixture({ 'plugin.yml': 'system_base_url: https://api.example.com\n' });
    try {
      await expect(loadPlugin(dir, {})).rejects.toThrow(/missing required field "plugin"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('names the missing system_base_url field', async () => {
    const dir = await fixture({ 'plugin.yml': 'plugin: reference\n' });
    try {
      await expect(loadPlugin(dir, {})).rejects.toThrow(/missing required field "system_base_url"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports an empty schemas directory', async () => {
    const dir = await fixture({ 'plugin.yml': BASE });
    try {
      await rm(join(dir, 'schemas'), { recursive: true });
      await mkdir(join(dir, 'schemas'));
      await expect(loadPlugin(dir, {})).rejects.toThrow(/No schema files found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails when signing_secret is declared but its variable resolves to empty', async () => {
    const dir = await fixture({ 'plugin.yml': BASE + 'auth:\n  signing_secret: ${ARS_SIGNING_SECRET}\n' });
    try {
      await expect(loadPlugin(dir, {})).rejects.toThrow(/ARS_SIGNING_SECRET/);
      await expect(loadPlugin(dir, { ARS_SIGNING_SECRET: '' })).rejects.toThrow(/signing_secret/);
      const ok = await loadPlugin(dir, { ARS_SIGNING_SECRET: 'x' });
      expect(ok.manifest.auth?.signing_secret).toBe('x');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('agent policies', () => {
  const policy = (name: string) =>
    `agent_policy: "1.0"
name: ${name}
autonomy:
  execute_up_to: validated
  ask_up_to: contextual
`;

  it('policies directory is loaded and invalid or duplicate policies fail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ars-pol-'));
    try {
      expect((await loadPlugin(REFERENCE_DIR, FAKE_ENV)).agentPolicies).toEqual([]);

      await cp(REFERENCE_DIR, dir, { recursive: true });
      await mkdir(join(dir, 'policies'));
      await writeFile(join(dir, 'policies', 'a.yml'), policy('alpha'));
      await writeFile(join(dir, 'policies', 'b.yaml'), policy('beta'));
      const plugin = await loadPlugin(dir, FAKE_ENV);
      expect(plugin.agentPolicies.map((p) => p.name)).toEqual(['alpha', 'beta']);

      await writeFile(join(dir, 'policies', 'README.md'), 'not: [valid yaml policy');
      expect((await loadPlugin(dir, FAKE_ENV)).agentPolicies.map((p) => p.name)).toEqual(['alpha', 'beta']);

      await writeFile(join(dir, 'policies', 'c.yml'), policy('alpha'));
      await expect(loadPlugin(dir, FAKE_ENV)).rejects.toThrow(/Duplicate agent policy name "alpha"/);
      await rm(join(dir, 'policies', 'c.yml'));

      await writeFile(join(dir, 'policies', 'bad.yml'), policy('bad').replace('validated', 'confirmation'));
      await expect(loadPlugin(dir, FAKE_ENV)).rejects.toThrow(/bad\.yml/);
      await rm(join(dir, 'policies', 'bad.yml'));

      const extra = await mkdtemp(join(tmpdir(), 'ars-pol-extra-'));
      try {
        await writeFile(join(extra, 'gamma.yml'), policy('gamma'));
        expect((await loadAgentPolicySources([join(extra, 'gamma.yml')])).map((p) => p.name)).toEqual(['gamma']);
        expect((await loadAgentPolicySources([extra, join(dir, 'policies')])).map((p) => p.name)).toEqual(['gamma', 'alpha', 'beta']);
        await expect(loadAgentPolicySources([extra, join(extra, 'gamma.yml')])).rejects.toThrow(/Duplicate agent policy name "gamma"/);
        await expect(loadAgentPolicySources([join(extra, 'nope.yml')])).rejects.toThrow(/not found/);
      } finally {
        await rm(extra, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
