import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { AgentReady } from '@agent-ready/core';

type Json = Record<string, any>;

export class OpenApiImportError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('; '));
    this.name = 'OpenApiImportError';
  }
}

export interface OpenApiImportResult {
  yaml: string;
  operations: string[];
  warnings: string[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const RISK_BY_METHOD: Record<(typeof METHODS)[number], { risk: string; policy: string }> = {
  get: { risk: 'free', policy: 'execute_immediately' },
  post: { risk: 'validated', policy: 'execute_after_validation' },
  put: { risk: 'contextual', policy: 'execute_after_validation' },
  patch: { risk: 'contextual', policy: 'execute_after_validation' },
  delete: { risk: 'confirmation', policy: 'require_explicit_confirmation' },
};

const MAX_REF_DEPTH = 20;

export function parseOpenApiText(text: string, origin: string): Json {
  let doc: unknown;
  try {
    doc = text.trimStart().startsWith('{') ? JSON.parse(text) : parseYaml(text);
  } catch (err: any) {
    throw new OpenApiImportError([`${origin} is not valid JSON or YAML: ${err.message}`]);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new OpenApiImportError([`${origin} is not a JSON or YAML object`]);
  }
  return doc as Json;
}

export async function loadOpenApiSource(source: string): Promise<Json> {
  if (/^https?:\/\//i.test(source)) {
    let res: Response;
    try {
      res = await fetch(source, { signal: AbortSignal.timeout(15000) });
    } catch (err: any) {
      throw new OpenApiImportError([`could not fetch ${source}: ${err.message}`]);
    }
    if (!res.ok) {
      throw new OpenApiImportError([`could not fetch ${source}: HTTP ${res.status}`]);
    }
    return parseOpenApiText(await res.text(), source);
  }
  const full = path.resolve(process.cwd(), source);
  if (!fs.existsSync(full)) {
    throw new OpenApiImportError([`file not found: ${source}`]);
  }
  return parseOpenApiText(fs.readFileSync(full, 'utf8'), source);
}

function slug(text: string, sep: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
}

export function convertOpenApi(doc: Json): OpenApiImportResult {
  const warnings: string[] = [];
  const problems: string[] = [];

  if (doc.swagger) {
    throw new OpenApiImportError([`Swagger ${doc.swagger} is not supported; convert it to OpenAPI 3.x first`]);
  }
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.')) {
    throw new OpenApiImportError(['not an OpenAPI 3.x document (missing "openapi: 3.x")']);
  }

  const warned = new Set<string>();
  const warnOnce = (msg: string) => {
    if (!warned.has(msg)) {
      warned.add(msg);
      warnings.push(msg);
    }
  };

  // hazard: cyclic $ref would recurse forever; depth-capped and degraded to {}
  const resolve = (node: any, depth = 0): Json => {
    if (!node || typeof node !== 'object') return {};
    if (typeof node.$ref !== 'string') return node;
    const ref: string = node.$ref;
    if (!ref.startsWith('#/')) {
      warnOnce(`external $ref ignored: ${ref}`);
      return {};
    }
    if (depth > MAX_REF_DEPTH) {
      warnOnce(`$ref too deep or cyclic, treated as any: ${ref}`);
      return {};
    }
    let cur: any = doc;
    for (const part of ref.slice(2).split('/')) {
      cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    if (cur === undefined) {
      warnOnce(`unresolved $ref ignored: ${ref}`);
      return {};
    }
    return resolve(cur, depth + 1);
  };

  const toField = (schemaNode: any, required: boolean, description?: string): Json => {
    const schema = resolve(schemaNode);
    const field: Json = {};
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      field.type = 'enum';
      field.values = schema.enum.map(String);
    } else if (schema.type === 'integer') field.type = 'int';
    else if (schema.type === 'number') field.type = 'decimal';
    else if (schema.type === 'boolean') field.type = 'bool';
    else if (schema.type === 'string') {
      field.type =
        schema.format === 'date' ? 'date'
        : schema.format === 'date-time' ? 'datetime'
        : schema.format === 'byte' ? 'base64'
        : 'string';
    } else field.type = 'any';
    field.required = required;
    const desc = description ?? schema.description;
    if (typeof desc === 'string' && desc.trim()) field.description = desc.trim();
    return field;
  };

  const jsonSchemaOf = (content: any): any => {
    if (!content || typeof content !== 'object') return undefined;
    const key = Object.keys(content).find((k) => k === 'application/json' || k.endsWith('+json') || k.endsWith('/json'));
    return key ? content[key]?.schema : undefined;
  };

  const paths: Json = doc.paths && typeof doc.paths === 'object' ? doc.paths : {};
  const operations: Json[] = [];
  const names = new Map<string, string>();

  for (const [p, rawItem] of Object.entries(paths)) {
    const item = resolve(rawItem);
    for (const method of METHODS) {
      const rawOp = item[method];
      if (!rawOp || typeof rawOp !== 'object') continue;
      const op = resolve(rawOp);
      const where = `${method.toUpperCase()} ${p}`;
      const name: string = typeof op.operationId === 'string' && op.operationId ? op.operationId : `${method}_${slug(p, '_')}`;
      if (names.has(name)) {
        problems.push(`duplicate operation name "${name}" (${names.get(name)} and ${where})`);
        continue;
      }
      names.set(name, where);

      const input: Json = {};
      const addField = (key: string, field: Json) => {
        if (key in input) {
          warnOnce(`${where}: field "${key}" appears more than once; kept the first`);
          return;
        }
        input[key] = field;
      };

      const params = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])];
      const byKey = new Map<string, Json>();
      for (const rawParam of params) {
        const param = resolve(rawParam);
        if ((param.in !== 'path' && param.in !== 'query') || typeof param.name !== 'string') continue;
        byKey.set(`${param.in}:${param.name}`, param);
      }
      const ordered = [...byKey.values()].sort((a, b) => (a.in === b.in ? 0 : a.in === 'path' ? -1 : 1));
      for (const param of ordered) {
        addField(param.name, toField(param.schema, param.in === 'path' || param.required === true, param.description));
      }

      const bodyNode = resolve(op.requestBody);
      const bodySchemaNode = jsonSchemaOf(bodyNode.content);
      if (bodySchemaNode) {
        const body = resolve(bodySchemaNode);
        const props = body.properties && typeof body.properties === 'object' ? body.properties : null;
        if (props) {
          const req = new Set<string>(Array.isArray(body.required) ? body.required : []);
          for (const [prop, propSchema] of Object.entries(props)) {
            addField(prop, toField(propSchema, req.has(prop)));
          }
        } else {
          addField('body', toField(body, bodyNode.required === true));
        }
      }

      const risk = RISK_BY_METHOD[method];
      const entry: Json = {
        id: `OP-OAI-${String(operations.length + 1).padStart(2, '0')}`,
        name,
        description: String(op.summary || op.description || where).trim(),
        risk_level: risk.risk,
        autonomy_policy: risk.policy,
      };
      if (Object.keys(input).length > 0) entry.input_schema = input;

      if (method === 'get') {
        const responses: Json = op.responses && typeof op.responses === 'object' ? op.responses : {};
        const okKey = Object.keys(responses).find((k) => /^2/.test(k));
        const respSchema = okKey ? resolve(jsonSchemaOf(resolve(responses[okKey]).content)) : {};
        if (respSchema.type === 'array') {
          const itemSchema = resolve(respSchema.items);
          const fields = itemSchema.properties && typeof itemSchema.properties === 'object' ? Object.keys(itemSchema.properties).slice(0, 3) : [];
          entry.response_strategy = fields.length > 0 ? { mode: 'summary', summary_fields: fields } : { mode: 'summary' };
        }
      }

      if (method === 'delete') {
        entry.human_confirmation = {
          required: true,
          message_template: `This will run ${name} (${where}). A human must approve before it runs.`,
        };
      }

      entry.signpost = { success: { message: `${name} completed.` } };
      operations.push(entry);
    }
  }

  if (operations.length === 0 && problems.length === 0) {
    problems.push('no operations found under "paths" (supported methods: get, post, put, patch, delete)');
  }
  if (problems.length > 0) throw new OpenApiImportError(problems);

  const title = typeof doc.info?.title === 'string' && doc.info.title.trim() ? doc.info.title.trim() : 'api';
  const schema = {
    schema_version: '0.1',
    module: slug(title, '-') || 'api',
    system: title,
    updated_at: new Date().toISOString().slice(0, 10),
    operations,
  };
  const yamlText = stringifyYaml(schema, { lineWidth: 0 });

  try {
    AgentReady.fromYAML(yamlText);
  } catch (err: any) {
    throw new OpenApiImportError([`generated schema is invalid: ${err.message}`]);
  }

  return { yaml: yamlText, operations: operations.map((o) => o.name), warnings };
}

export async function importOpenApi(source: string): Promise<OpenApiImportResult> {
  return convertOpenApi(await loadOpenApiSource(source));
}
