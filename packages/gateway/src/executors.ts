import type { ExecutorFn, ExecutorMap } from '@agent-ready/adapter-mcp';
import type { ExecutorMethod, ExecutorSpec, LoadedPlugin, PluginManifest } from './plugin.js';

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** Replace `{{field}}` placeholders with `String(input[field])`. No encoding — callers encode at the point of use (path/query). */
export function renderTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = input[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function fieldsInTemplate(template: string): string[] {
  return Array.from(template.matchAll(PLACEHOLDER), (m) => m[1]);
}

/** True when every field the template references is absent from input (key not present, or null/undefined). */
function referencesOnlyMissingFields(template: string, input: Record<string, unknown>): boolean {
  const fields = fieldsInTemplate(template);
  if (fields.length === 0) return false;
  return fields.every((field) => input[field] === undefined || input[field] === null);
}

/** Render a URL path template, percent-encoding each substituted value (not the literal slashes in the template). */
function renderPath(template: string, input: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = input[key];
    const str = value === undefined || value === null ? '' : String(value);
    return encodeURIComponent(str);
  });
}

/** Build a `?query=string` from the spec's templates, omitting params whose template only referenced an absent field. */
function buildQueryString(querySpec: Record<string, string> | undefined, input: Record<string, unknown>): string {
  if (!querySpec) return '';
  const params = new URLSearchParams();
  for (const [key, template] of Object.entries(querySpec)) {
    const rendered = renderTemplate(template, input);
    if (rendered === '' && referencesOnlyMissingFields(template, input)) continue;
    params.append(key, rendered);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Recursively render `{{field}}` templates in string leaves of a JSON-like body spec. */
function renderBodyDeep(value: unknown, input: Record<string, unknown>): unknown {
  if (typeof value === 'string') return renderTemplate(value, input);
  if (Array.isArray(value)) return value.map((item) => renderBodyDeep(item, input));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = renderBodyDeep(item, input);
    }
    return out;
  }
  return value;
}

export interface BuildExecutorOptions {
  fetchImpl?: typeof fetch;
  getActingUser?: () => string | undefined;
}

function defaultMethod(spec: ExecutorSpec): ExecutorMethod {
  if (spec.method) return spec.method;
  return spec.body_from_input || spec.body !== undefined ? 'POST' : 'GET';
}

/**
 * Build one ExecutorFn from a declarative spec. The returned function performs the
 * actual HTTP call — this is where the "no code per system" promise is fulfilled:
 * the same generic logic serves any operation, driven only by executors.yml.
 */
export function buildExecutor(
  operationName: string,
  spec: ExecutorSpec,
  manifest: PluginManifest,
  opts: BuildExecutorOptions = {},
): ExecutorFn {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = manifest.system_base_url.replace(/\/+$/, '');
  const method = defaultMethod(spec);
  const actingUserHeader = manifest.auth?.acting_user_header ?? 'X-Acting-User';

  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const path = renderPath(spec.path, input);
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${baseUrl}${normalizedPath}${buildQueryString(spec.query, input)}`;

    let body: string | undefined;
    if (spec.body_from_input) {
      body = JSON.stringify(input);
    } else if (spec.body !== undefined) {
      body = JSON.stringify(renderBodyDeep(spec.body, input));
    }

    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (manifest.auth?.service_token) {
      headers['Authorization'] = `Bearer ${manifest.auth.service_token}`;
    }
    const actingUser = opts.getActingUser?.();
    if (actingUser) {
      headers[actingUserHeader] = actingUser;
    }
    for (const [key, value] of Object.entries(manifest.auth?.extra_headers ?? {})) {
      if (value) headers[key] = value;
    }
    if (spec.headers) {
      for (const [key, template] of Object.entries(spec.headers)) {
        headers[key] = renderTemplate(template, input);
      }
    }

    const response = await fetchImpl(url, { method, headers, body });

    if (response.status >= 400) {
      const text = await response.text().catch(() => '');
      throw new Error(`${operationName}: HTTP ${response.status} — ${text.slice(0, 300)}`);
    }
    if (response.status === 204) return {};

    const text = await response.text();
    if (text === '') return {};

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { raw: text };
    }
    if (Array.isArray(data)) return { items: data };
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    return { raw: text };
  };
}

/** Build an ExecutorMap for every entry in a loaded plugin's executors.yml. */
export function buildExecutorMap(plugin: LoadedPlugin, opts: BuildExecutorOptions = {}): ExecutorMap {
  const map: ExecutorMap = {};
  for (const [operationName, spec] of Object.entries(plugin.executorSpecs)) {
    map[operationName] = buildExecutor(operationName, spec, plugin.manifest, opts);
  }
  return map;
}
