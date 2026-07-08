import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { AgentReady } from '@agent-ready/core';

/** HTTP method an executor sends. */
export type ExecutorMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Auth block of a plugin manifest — how the gateway authenticates against the target system. */
export interface PluginAuth {
  mode?: string;
  service_token?: string;
  /** Header carrying the acting user's identity. Defaults to 'X-Acting-User' when omitted. */
  acting_user_header?: string;
}

/** `plugin.yml` — the manifest at the root of a plugin directory. */
export interface PluginManifest {
  plugin: string;
  system_base_url: string;
  auth?: PluginAuth;
}

/** One entry of `executors.yml` — declarative HTTP mapping for one ARS operation. */
export interface ExecutorSpec {
  method?: ExecutorMethod;
  /** URL path, may contain `{{field}}` placeholders. */
  path: string;
  /** Query string params, each value a `{{field}}` template. */
  query?: Record<string, string>;
  /** Extra headers, values may be `{{field}}` templates. */
  headers?: Record<string, string>;
  /** Static JSON body, string values may be `{{field}}` templates. */
  body?: Record<string, unknown>;
  /** When true, the whole validated input is sent as the JSON body verbatim. */
  body_from_input?: boolean;
}

/** A fully loaded plugin: manifest, ARS agent (merged schemas), and executor specs. */
export interface LoadedPlugin {
  name: string;
  dir: string;
  manifest: PluginManifest;
  agent: AgentReady;
  executorSpecs: Record<string, ExecutorSpec>;
}

const ENV_PLACEHOLDER = /\$\{(\w+)\}/g;

/**
 * Replace `${VAR}` placeholders with values from `env`. Unset variables become
 * an empty string rather than throwing — plugin manifests are meant to load
 * (and fail later, at request time) even with incomplete configuration.
 */
export function substituteEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(ENV_PLACEHOLDER, (_match, name: string) => env[name] ?? '');
}

/** Recursively apply substituteEnv() to every string value in a parsed YAML tree. */
function substituteEnvDeep(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === 'string') return substituteEnv(value, env);
  if (Array.isArray(value)) return value.map((item) => substituteEnvDeep(item, env));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = substituteEnvDeep(item, env);
    }
    return out;
  }
  return value;
}

async function readYamlFile(filePath: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`[gateway] Cannot read file "${filePath}": ${(err as Error).message}`);
  }
  try {
    return parse(content);
  } catch (err) {
    throw new Error(`[gateway] Failed to parse YAML "${filePath}": ${(err as Error).message}`);
  }
}

function pickYamlFile(entries: string[], baseName: string): string | undefined {
  if (entries.includes(`${baseName}.yml`)) return `${baseName}.yml`;
  if (entries.includes(`${baseName}.yaml`)) return `${baseName}.yaml`;
  return undefined;
}

/**
 * Load a plugin directory:
 *   <dir>/plugin.yml        — manifest (system_base_url, auth)
 *   <dir>/schemas/*.yml     — one or more ARS schema files, merged in alphabetical order
 *   <dir>/executors.yml     — operation name -> HTTP executor spec
 *
 * Every missing piece throws a specific, actionable error — a plugin gateway
 * is only as trustworthy as its config, so silent partial loads are not an option.
 */
export async function loadPlugin(dir: string, env: NodeJS.ProcessEnv = process.env): Promise<LoadedPlugin> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new Error(`[gateway] Plugin directory not found: "${dir}"`);
  }

  const manifestFile = pickYamlFile(entries, 'plugin');
  if (!manifestFile) {
    throw new Error(`[gateway] Missing plugin.yml in plugin directory "${dir}"`);
  }
  const rawManifest = await readYamlFile(join(dir, manifestFile));
  const manifest = substituteEnvDeep(rawManifest, env) as PluginManifest;

  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`[gateway] Invalid plugin.yml in "${dir}": must be a YAML object`);
  }
  if (!manifest.plugin) {
    throw new Error(`[gateway] plugin.yml in "${dir}" is missing required field "plugin"`);
  }
  if (!manifest.system_base_url) {
    throw new Error(`[gateway] plugin.yml in "${dir}" is missing required field "system_base_url"`);
  }

  const schemasDir = join(dir, 'schemas');
  let schemaFiles: string[];
  try {
    schemaFiles = (await readdir(schemasDir))
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort();
  } catch {
    throw new Error(`[gateway] Missing schemas/ directory in plugin "${dir}"`);
  }
  if (schemaFiles.length === 0) {
    throw new Error(`[gateway] No schema files found in "${schemasDir}"`);
  }

  const agent = await AgentReady.fromFiles(schemaFiles.map((f) => join(schemasDir, f)));

  const executorsFile = pickYamlFile(entries, 'executors');
  if (!executorsFile) {
    throw new Error(
      `[gateway] Missing executors.yml in plugin directory "${dir}" — every operation needs an HTTP executor mapping.`,
    );
  }
  const rawExecutors = await readYamlFile(join(dir, executorsFile));
  const executorSpecs = (rawExecutors ?? {}) as Record<string, ExecutorSpec>;

  return {
    name: String(manifest.plugin),
    dir,
    manifest,
    agent,
    executorSpecs,
  };
}
