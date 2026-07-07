/**
 * @agent-ready/core
 *
 * Runtime engine for Agent-Ready Schema.
 * Governance layer for AI agents — the layer MCP doesn't have.
 *
 * MCP is the transport (discovers + calls tools).
 * ARS is the brain (validates, assesses risk, enforces autonomy, generates signposts).
 *
 * @example
 * import { AgentReady } from '@agent-ready/core';
 *
 * const agent = await AgentReady.fromFile('./schemas/financeiro.yml');
 * const op = agent.operation('registrar_gasto');
 *
 * const result = op.validate({ descricao: 'mercado', valor: 50, categoria_id: 15, membro_id: 1 });
 * if (!result.valid) {
 *   return op.signpost('validation_error', { errors: result.errors });
 * }
 * if (result.needsHumanConfirmation) {
 *   return op.signpost('pending', { valor: 50, descricao: 'mercado' });
 * }
 *
 * // ... execute the operation via your API ...
 * const apiResult = await api.post('/gastos', input);
 *
 * return op.signpost('success', apiResult);
 */

export * from './types.js';
export * from './loader.js';
export * from './validator.js';
export * from './signpost.js';
export * from './risk.js';
export * from './adapter.js';

import {
  loadSchema,
  loadSchemaFromFile,
  mergeSchemas,
  findOperation,
  listOperations,
  getInputFields,
} from './loader.js';
import { validateInput, applyDefaults, validateForeignKeys } from './validator.js';
import { generateSignpost } from './signpost.js';
import { assessRisk, getRiskLabel, getRiskMatrix } from './risk.js';
import { createAdapter, noopAdapter } from './adapter.js';
import type {
  AgentReadySchema,
  Operation,
  ValidationResult,
  SignpostResult,
  AdapterResolvers,
  RiskLevel,
  FieldError,
} from './types.js';
import type { Adapter } from './adapter.js';
import type { RiskAssessment } from './risk.js';

// ─────────────────────────────────────────────
// OperationHandle
// ─────────────────────────────────────────────

/**
 * A handle to a single operation — fluent interface for validation, signpost, and risk.
 */
export class OperationHandle {
  constructor(
    private readonly _operation: Operation,
    private readonly _adapter: Adapter,
  ) {}

  /** The raw operation definition */
  get definition(): Operation {
    return this._operation;
  }

  /** Risk level of this operation */
  get riskLevel(): RiskLevel {
    return this._operation.risk_level;
  }

  /** True if operation is free — no validation needed */
  get isFree(): boolean {
    return this._operation.risk_level === 'free';
  }

  /** True if operation always requires human confirmation */
  get needsConfirmation(): boolean {
    return (
      this._operation.risk_level === 'confirmation' ||
      this._operation.human_confirmation?.required === true
    );
  }

  /** True if operation requires state guards to be checked */
  get needsStateValidation(): boolean {
    return (
      this._operation.risk_level === 'contextual' ||
      this._operation.risk_level === 'confirmation'
    );
  }

  /** True if operation requires input validation */
  get needsValidation(): boolean {
    return this._operation.risk_level !== 'free';
  }

  /** Risk label with emoji */
  riskLabel(locale: 'en' | 'pt' = 'en'): string {
    return getRiskLabel(this._operation.risk_level, locale);
  }

  /** Full risk assessment */
  get risk(): RiskAssessment {
    return assessRisk(this._operation);
  }

  /** Normalized input fields */
  get fields() {
    return getInputFields(this._operation);
  }

  /**
   * Apply defaults to an input object before validation.
   *
   * @param input - Raw input from the agent
   * @param context - Agent context (membro_id, conta, etc.)
   */
  applyDefaults(
    input: Record<string, unknown>,
    context: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return applyDefaults(this._operation, input, context);
  }

  /**
   * Validate an input against this operation's schema.
   *
   * @param input - Input (after applyDefaults)
   * @param context - Agent context for infer_from_context fields
   */
  validate(
    input: Record<string, unknown>,
    context: Record<string, unknown> = {},
  ): ValidationResult {
    return validateInput(this._operation, input, context);
  }

  /**
   * Generate a signpost response.
   * Every response is a signpost — with guidance, context, and next steps.
   *
   * @param type - 'success' | 'validation_error' | 'not_found' | 'pending' | 'blocked_transition' | 'low_confidence'
   * @param data - Result data or error context
   */
  signpost(type: SignpostResult['type'], data: Record<string, unknown> = {}): SignpostResult {
    return generateSignpost(this._operation, type, data);
  }

  /**
   * Resolve a state guard predicate via the adapter.
   *
   * @param predicateName - e.g. 'month.is_open', 'entity.exists'
   * @param params - Parameters to pass to the resolver
   */
  async resolveGuard(predicateName: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this._adapter.resolve(predicateName, params);
  }

  /**
   * Validate foreign_key constraints via the adapter's FK_PREDICATE
   * ('entity.exists') resolver. Complements validate(), which is synchronous
   * and never touches the backend. Returns [] when the adapter has no
   * FK_PREDICATE resolver.
   *
   * @param input - Input (after applyDefaults)
   */
  async validateForeignKeys(input: Record<string, unknown>): Promise<FieldError[]> {
    return validateForeignKeys(this._operation, input, this._adapter);
  }
}

// ─────────────────────────────────────────────
// AgentReady (main entry point)
// ─────────────────────────────────────────────

/**
 * Main entry point for @agent-ready/core.
 *
 * @example
 * // Load from file
 * const agent = await AgentReady.fromFile('./schemas/financeiro.yml', {
 *   'month.is_open': async ({ ano, mes }) => !db.get('SELECT fechado FROM meses WHERE ...').fechado
 * });
 *
 * // Load from YAML string
 * const agent = AgentReady.fromYAML(yamlString);
 *
 * // Use
 * const op = agent.operation('registrar_gasto'); // throws if not found
 * const op = agent.find('registrar_gasto');       // returns undefined if not found
 */
export class AgentReady {
  private constructor(
    private readonly _schema: AgentReadySchema,
    private readonly _adapter: Adapter,
  ) {}

  // ── Factory methods ──────────────────────────

  /** Load from a YAML file path */
  static async fromFile(
    filePath: string,
    resolvers: AdapterResolvers = {},
  ): Promise<AgentReady> {
    const schema = await loadSchemaFromFile(filePath);
    const adapter = Object.keys(resolvers).length > 0
      ? createAdapter(resolvers)
      : noopAdapter();
    return new AgentReady(schema, adapter);
  }

  /** Load from a YAML string */
  static fromYAML(
    yamlContent: string,
    resolvers: AdapterResolvers = {},
  ): AgentReady {
    const schema = loadSchema(yamlContent);
    const adapter = Object.keys(resolvers).length > 0
      ? createAdapter(resolvers)
      : noopAdapter();
    return new AgentReady(schema, adapter);
  }

  /** Merge multiple schema files */
  static async fromFiles(
    filePaths: string[],
    resolvers: AdapterResolvers = {},
  ): Promise<AgentReady> {
    const schemas = await Promise.all(filePaths.map(loadSchemaFromFile));
    const merged = mergeSchemas(...schemas);
    const adapter = Object.keys(resolvers).length > 0
      ? createAdapter(resolvers)
      : noopAdapter();
    return new AgentReady(merged, adapter);
  }

  // ── Schema introspection ─────────────────────

  /** The raw schema */
  get schema(): AgentReadySchema {
    return this._schema;
  }

  /** List all operation names */
  get operations(): string[] {
    return listOperations(this._schema);
  }

  /** Check if an operation exists */
  has(nameOrId: string): boolean {
    return findOperation(this._schema, nameOrId) !== undefined;
  }

  /** All raw operation definitions */
  get allOperations(): Operation[] {
    return this._schema.operations;
  }

  // ── Operation access ─────────────────────────

  /**
   * Get an OperationHandle by name or id.
   * @throws {Error} If operation not found
   */
  operation(nameOrId: string): OperationHandle {
    const op = findOperation(this._schema, nameOrId);
    if (!op) {
      throw new Error(
        `[agent-ready] Operation "${nameOrId}" not found in schema "${this._schema.module}". ` +
        `Available: ${listOperations(this._schema).join(', ')}`,
      );
    }
    return new OperationHandle(op, this._adapter);
  }

  /**
   * Get an OperationHandle — returns undefined if not found.
   */
  find(nameOrId: string): OperationHandle | undefined {
    const op = findOperation(this._schema, nameOrId);
    if (!op) return undefined;
    return new OperationHandle(op, this._adapter);
  }

  // ── Risk matrix ──────────────────────────────

  /** Get the risk matrix for all operations, sorted highest risk first */
  get riskMatrix() {
    return getRiskMatrix(this._schema.operations);
  }
}
