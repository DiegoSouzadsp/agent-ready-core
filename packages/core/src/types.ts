/**
 * @agent-ready/core — Type definitions for Agent-Ready Schema v0.1
 *
 * Implements the governance layer for AI agents:
 * - Risk classification (free → validated → contextual → confirmation)
 * - Autonomy policy enforcement
 * - Signpost responses (Felipe Amorim's 4 rules)
 * - Input validation and state guards
 */

// ─────────────────────────────────────────────
// Risk & Autonomy
// ─────────────────────────────────────────────

/** Risk classification for an operation */
export type RiskLevel = 'free' | 'validated' | 'contextual' | 'confirmation';

/**
 * What the agent is allowed to do based on risk_level.
 * - execute_immediately: no validation needed
 * - execute_after_validation: validate inputs then execute
 * - validate_state_then_execute: validate inputs + check state guards
 * - require_explicit_confirmation: always ask human first
 */
export type AutonomyPolicy =
  | 'execute_immediately'
  | 'execute_after_validation'
  | 'validate_state_then_execute'
  | 'require_explicit_confirmation';

// ─────────────────────────────────────────────
// Input Schema
// ─────────────────────────────────────────────

/** Condition for required_if field */
export interface RequiredIfCondition {
  /** The other field to check */
  field: string;
  /** The value that triggers this field becoming required */
  value: unknown;
}

/** Foreign key constraint */
export interface ForeignKey {
  /** Database table to check */
  table: string;
  /** Optional filters to apply */
  filter?: Record<string, unknown>;
}

/** Condition that triggers human confirmation for a field */
export interface HumanConfirmationIf {
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  eq?: unknown;
}

/** A single input field definition */
export interface InputField {
  /** Field name (added when normalizing from map to array) */
  name?: string;
  /** Data type */
  type: 'string' | 'int' | 'decimal' | 'bool' | 'date' | 'datetime' | 'enum' | 'base64' | 'any';
  /** Whether this field is required */
  required?: boolean;
  /** Conditionally required based on another field's value */
  required_if?: RequiredIfCondition;
  /** Default value */
  default?: unknown;
  /** Default value based on operation type (map of type → value) */
  default_by_tipo?: Record<string, unknown>;
  /** Can be inferred from agent context */
  infer_from_context?: boolean;
  /** Minimum string length */
  min_length?: number;
  /** Maximum string length */
  max_length?: number;
  /** Minimum numeric value (inclusive) */
  min?: number;
  /** Maximum numeric value (inclusive) */
  max?: number;
  /** Minimum numeric value (exclusive) */
  gt?: number;
  /** Minimum numeric value (inclusive) */
  gte?: number;
  /** Date/string format (e.g. 'YYYY-MM-DD') */
  format?: string;
  /** Allowed enum values */
  values?: string[];
  /** Date constraint: 'future' | 'past' | 'today' */
  must_be?: string;
  /** String must contain this substring */
  must_contain?: string;
  /** Foreign key constraint */
  foreign_key?: ForeignKey;
  /** Human-readable description */
  description?: string;
  /** Triggers human confirmation if condition is met */
  human_confirmation_if?: HumanConfirmationIf;
}

// ─────────────────────────────────────────────
// Validation Rules & State Guards
// ─────────────────────────────────────────────

/** Policy when a validation rule fails */
export type ValidationFailPolicy = 'block' | 'warn' | 'human_confirmation';

/** What to do when a rule fails */
export interface OnFail {
  policy?: ValidationFailPolicy;
  message?: string;
}

/** A validation rule for business logic (beyond field-level) */
export interface ValidationRule {
  id: string;
  description?: string;
  /** SQL or expression query */
  query?: string;
  /** Assert that query result matches this */
  assert?: Record<string, unknown>;
  /** Assert that query returns no rows */
  assert_empty?: boolean;
  /** Boolean expression check */
  check?: string;
  /** Warn (not block) if expression is true */
  warn_if?: string;
  /** Override default policy */
  policy?: ValidationFailPolicy;
  on_fail?: OnFail;
  /** Valid state transitions */
  transitions?: Record<string, string[]>;
  /** What to do on invalid transition */
  on_invalid?: OnFail;
}

/** A pre-condition that must be true before executing */
export interface StateGuard {
  description: string;
  /** SQL query to run */
  query: string;
  /** Expected result of the query */
  assert: Record<string, unknown>;
  on_fail: {
    message: string;
    suggest?: string;
  };
}

// ─────────────────────────────────────────────
// Human Confirmation
// ─────────────────────────────────────────────

/** Configuration for operations requiring human confirmation */
export interface HumanConfirmation {
  required?: boolean;
  /** Template with {{field}} placeholders */
  message_template?: string;
  /** Status to set while waiting */
  pending_status?: string;
}

// ─────────────────────────────────────────────
// Computed Fields & Side Effects
// ─────────────────────────────────────────────

/** A field computed from other fields */
export interface ComputedField {
  name: string;
  formula: string;
}

/** Alert condition on side effect */
export interface AlertIf {
  gte?: number;
  gt?: number;
  lte?: number;
  lt?: number;
  eq?: unknown;
}

/** A side effect triggered after operation execution */
export interface SideEffect {
  id: string;
  description?: string;
  trigger_if_field_present?: string;
  trigger_if_field_changed?: string;
  /** SQL query to evaluate */
  query?: string;
  /** Action to perform */
  action?: string;
  /** Parameters for the action */
  params?: Record<string, unknown>;
  /** Condition to trigger an alert */
  alert_if?: AlertIf;
  /** Template for alert message */
  message_template?: string;
  /** Days before event to trigger */
  dias_antes?: number;
}

// ─────────────────────────────────────────────
// Signpost Configuration (schema-level, stored in YAML)
// ─────────────────────────────────────────────

/** A next action suggestion in the signpost */
export interface NextAction {
  /** Operation name to suggest */
  operation: string;
  /** Why this action is suggested (Rule 1 & 3: errors teach, every response is a signpost) */
  reason: string;
  /** Pre-filled params for the next operation */
  params?: Record<string, unknown>;
}

/** Success signpost config from schema */
export interface SignpostSuccessConfig {
  /** Fields to include from operation result */
  include?: string[];
  message?: string;
  message_template?: string;
  /** Side effect ids to check for alerts */
  alerts?: string[];
  /**
   * Next actions. Can be:
   * - string[] (operation names, generic reason added at runtime)
   * - NextAction[] (with explicit reason)
   */
  next_actions?: (string | NextAction)[];
}

/** Validation error signpost config */
export interface SignpostErrorConfig {
  message?: string;
  message_template?: string;
  include_errors?: boolean;
  next_actions?: (string | NextAction)[];
}

/** Not-found signpost config (Rule 1: errors must teach) */
export interface SignpostNotFoundConfig {
  guidance?: string;
  suggestions?: (string | NextAction)[];
}

/** Blocked transition signpost config */
export interface SignpostBlockedConfig {
  message?: string;
  message_template?: string;
  next_actions?: (string | NextAction)[];
}

/** Low confidence signpost config */
export interface SignpostLowConfidenceConfig {
  message?: string;
  message_template?: string;
  next_actions?: (string | NextAction)[];
}

/** Full signpost configuration from YAML schema */
export interface SignpostConfig {
  success?: SignpostSuccessConfig;
  validation_error?: SignpostErrorConfig;
  not_found?: SignpostNotFoundConfig;
  pending?: {
    message?: string;
    message_template?: string;
    include?: string[];
  };
  blocked_transition?: SignpostBlockedConfig;
  low_confidence?: SignpostLowConfidenceConfig;
}

// ─────────────────────────────────────────────
// Signpost Result (RUNTIME output — Felipe Amorim's 4 rules)
// ─────────────────────────────────────────────

/** Alert in a runtime signpost */
export interface SignpostAlert {
  level: 'info' | 'warning' | 'critical';
  reason: string;
}

/** A field-level validation error */
export interface FieldError {
  field: string;
  message: string;
  /** Machine-readable error code */
  code: string;
}

/**
 * The RUNTIME signpost result — auto-sufficient response for AI agents.
 *
 * Implements Felipe Amorim's 4 rules:
 * - Rule 1: Errors must teach (reason + what_to_do + suggestions)
 * - Rule 2: Lists are menus (response_strategy)
 * - Rule 3: Every response is a signpost (guidance always present)
 * - Rule 4: Write for reader who cannot see docs (_context is self-sufficient)
 */
export interface SignpostResult {
  /** Signpost type */
  type: 'success' | 'validation_error' | 'not_found' | 'pending' | 'blocked_transition' | 'low_confidence';

  /**
   * Plain text guidance — ALWAYS present.
   * Rule 3: Every response is a signpost.
   * Rule 4: The agent has this response, not your docs.
   */
  guidance: string;

  /**
   * Context about what happened — makes response self-sufficient.
   * Rule 4: Write for the reader who cannot see your docs.
   */
  _context: {
    operation: string;
    risk_level: RiskLevel;
    what_happened?: string;
  };

  /** Filtered data from the operation result */
  data?: Record<string, unknown>;

  /** Alerts triggered by side effects */
  alerts?: SignpostAlert[];

  /**
   * Next actions with reasons — enables agent to navigate autonomously.
   * Rule 3: Every response is a signpost.
   */
  next?: NextAction[];

  // ── Error-specific fields (Rule 1: Errors must teach) ──

  /** Why this failed — in plain language */
  reason?: string;

  /** What to do next — actionable instruction */
  what_to_do?: string;

  /** Field-level validation errors */
  errors?: FieldError[];

  /** Alternative operations to try (for not_found, validation_error) */
  suggestions?: NextAction[];
}

// ─────────────────────────────────────────────
// Response Strategy (Rule 2: Lists are menus, not meals)
// ─────────────────────────────────────────────

/**
 * Defines how operation results should be returned.
 * Rule 2: Lists are menus, not meals — return lean summaries with path to depth.
 */
export interface ResponseStrategy {
  /** 'summary' returns lean data, 'full' returns everything, 'paginated' for large sets */
  mode: 'summary' | 'full' | 'paginated';
  /** Operation to call for full details (when mode is 'summary') */
  detail_operation?: string;
  /** Guidance text pointing agent to the detail operation */
  guidance?: string;
  /** Page size for paginated mode */
  page_size?: number;
}

// ─────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────

/** Audit configuration for an operation */
export interface Audit {
  log: boolean;
  include_fields?: string[];
}

// ─────────────────────────────────────────────
// Operation
// ─────────────────────────────────────────────

/** A single operation in the Agent-Ready Schema */
export interface Operation {
  /** Unique operation identifier (e.g. 'OP-FIN-01') */
  id: string;
  /** Operation name (e.g. 'registrar_gasto') */
  name: string;
  description?: string;
  /** Module this operation belongs to */
  module?: string;
  /** Risk classification */
  risk_level: RiskLevel;
  /** What the agent can do based on risk */
  autonomy_policy: AutonomyPolicy;
  /**
   * Input schema — can be a map (from YAML) or normalized array.
   * Use normalizeInputSchema() from loader to convert to array.
   */
  input_schema?: Record<string, InputField> | InputField[];
  /** Business rule validations */
  validation_rules?: ValidationRule[];
  /** Pre-conditions that must be true */
  state_guards?: StateGuard[];
  /** Human confirmation config */
  human_confirmation?: HumanConfirmation;
  /** Computed fields from other fields */
  computed_fields?: ComputedField[];
  /** Side effects and their triggers */
  side_effects?: SideEffect[];
  /** Signpost config (schema-level, static) */
  signpost?: SignpostConfig;
  /** Response strategy for this operation */
  response_strategy?: ResponseStrategy;
  /** Audit configuration */
  audit?: Audit;
}

// ─────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────

/** Root Agent-Ready Schema object */
export interface AgentReadySchema {
  schema_version: string;
  module: string;
  system?: string;
  updated_at?: string;
  operations: Operation[];
}

// ─────────────────────────────────────────────
// Validation Result
// ─────────────────────────────────────────────

/** Result of validating an input against an operation */
export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
  warnings: FieldError[];
  /** Whether human confirmation is required before executing */
  needsHumanConfirmation: boolean;
  /** Reasons why confirmation is needed */
  confirmationReasons: string[];
  riskLevel: RiskLevel;
  autonomyPolicy: AutonomyPolicy;
}

// ─────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────

/**
 * Resolver functions for resolving abstract predicates against a real backend.
 * MCP is the transport. ARS adapters are the governance resolvers.
 *
 * @example
 * const resolvers: AdapterResolvers = {
 *   'month.is_open': async ({ ano, mes }) => {
 *     const row = db.prepare('SELECT fechado FROM meses WHERE ano=? AND mes=?').get(ano, mes);
 *     return !row?.fechado;
 *   }
 * };
 */
export type AdapterResolvers = Record<
  string,
  (params: Record<string, unknown>) => Promise<unknown> | unknown
>;
