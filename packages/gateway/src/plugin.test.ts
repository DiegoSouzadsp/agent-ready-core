import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadPlugin, substituteEnv } from './plugin.js';

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
