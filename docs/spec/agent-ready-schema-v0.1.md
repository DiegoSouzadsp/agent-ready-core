# Agent-Ready Schema — Specification v0.1

> Proposed open standard for systems safely operable by autonomous AI agents.
> Status: Draft — First experimental implementation: FamilyOS

---

## Motivation

APIs were always designed for humans to program against.
The agent is the first consumer that reads, interprets, and decides.

But reading isn't enough. For an agent to operate a system with real autonomy — without a human in the loop at every step — the system needs to expose contracts the agent can load and validate, not just documentation the agent tries to follow.

Agent-Ready Schema is that contract.

---

## Structure of a schema

Every Agent-Ready schema is a YAML file with the following top-level fields:

```yaml
schema_version: string       # standard version (e.g. "0.1")
module: string                # module name (e.g. finance)
system: string                 # system name (e.g. familyos)
updated_at: date               # last update date
operations: list[Operation]    # list of operations
```

---

## Operation structure

```yaml
id: string
# Unique identifier. Recommended format: OP-{MODULE}-{SEQ}
# E.g.: OP-FIN-01

name: string
# snake_case operation name. Used by the agent to reference it.
# E.g.: registrar_gasto

description: string
# Natural-language description of what the operation does.

module: string
# The module this operation belongs to.

risk_level: enum
# Risk classification of the operation. See the risk levels table below.
# Values: free | validated | contextual | confirmation

autonomy_policy: enum
# Execution policy derived from risk_level.
# Values: execute_immediately | execute_after_validation |
#          validate_state_then_execute | require_explicit_confirmation

input_schema: map[string, Field]
# Input fields. See the Field structure below.

validation_rules: list[ValidationRule]   # optional
# Validation rules beyond field-level checks (e.g. no duplicates, OCR confidence).

state_guards: list[StateGuard]           # optional
# System state conditions that must hold true before execution.

human_confirmation: HumanConfirmation    # required if risk_level == confirmation
# Configuration for the explicit confirmation required.

computed_fields: list[ComputedField]     # optional
# Fields automatically computed from the inputs.

side_effects: list[SideEffect]           # optional
# Side actions triggered after a successful execution.

signpost: Signpost
# What the agent should return after the operation. See the Signpost structure below.

audit: Audit
# Audit and logging configuration.
```

---

## Risk levels

| risk_level   | autonomy_policy                    | Description |
|--------------|-----------------------------------|-----------|
| free         | execute_immediately                | Pure read. No state modified. Agent executes directly. |
| validated    | execute_after_validation           | Creates or modifies state. Agent validates fields and rules first. |
| contextual   | validate_state_then_execute        | Modifies existing state. Agent checks for valid transitions. May pause if ambiguous. |
| confirmation | require_explicit_confirmation      | Irreversible. Agent presents a summary and requires a confirmation token before executing. |

---

## Field structure

```yaml
field_name:
  type: string | int | decimal | bool | date | datetime | enum | base64 | any
  required: bool
  required_if:                    # optional — conditional
    field: string
    value: any
  default: any                    # optional
  default_by_tipo: map            # optional — default based on another field's value
  infer_from_context: bool        # optional — agent looks it up in the Hermes context
  min_length: int                 # optional — for string
  max_length: int                 # optional — for string
  min: number                     # optional — for numeric
  max: number                     # optional — for numeric
  gt: number                      # optional — greater than
  gte: number                     # optional — greater than or equal
  format: string                  # optional — e.g. YYYY-MM-DD
  values: list                    # required for type: enum
  must_be: string                 # optional — e.g. future (for datetime)
  must_contain: string            # optional — for explicit confirmations
  foreign_key:                    # optional
    table: string
    filter: map                   # optional — WHERE conditions
  description: string             # optional — human-readable annotation
  human_confirmation_if:          # optional — pauses for confirmation if the condition is true
    gt: number
    gte: number
    lt: number
    lte: number
    eq: any
```

---

## ValidationRule structure

```yaml
- id: string
  description: string
  query: string                   # SQL with :params
  assert: map                     # condition that must hold true
  assert_empty: bool               # result must be empty
  check: string                    # boolean expression (e.g. ocr_confidence >= 0.8)
  warn_if: map                     # condition that triggers a warning (does not block)
  policy: show_diff | human_confirmation   # what to do when the rule fails
  on_fail:
    message: string                # message with {{field}} template
    policy: string                 # block | human_confirmation | warn
    suggest: string                # suggested next action
  transitions:                     # for state-machine validation
    current_state: list[allowed_states]
  on_invalid:
    message: string
```

---

## StateGuard structure

```yaml
- description: string
  query: string                   # SQL that returns the current state
  assert: map                     # condition that must hold true
  on_fail:
    message: string
    suggest: string                # suggested next action
```

---

## HumanConfirmation structure

```yaml
required: bool
message_template: string          # message with {{field}} template shown before executing
pending_status: int                # HTTP status code while awaiting confirmation (e.g. 202)
```

---

## ComputedField structure

```yaml
- name: string
  formula: string                 # arithmetic expression over input fields and queries
```

---

## SideEffect structure

```yaml
- id: string
  description: string
  trigger_if_field_present: string    # runs only if the field is present
  trigger_if_field_changed: list       # runs only if one of these fields changed
  query: string                        # SQL executed as a side effect
  action: string                       # name of another operation to trigger
  params: map                          # parameters passed to that action
  alert_if: map                        # condition that produces an alert in the signpost
  message_template: string
  dias_antes: int                      # for reminder-style side effects ("days before")
```

---

## Signpost structure

```yaml
success:
  include: list[string]           # result fields to include in the response
  message: string                  # optional fixed message
  message_template: string         # message with {{field}} template
  alerts: list[string]             # side_effect ids whose alerts should surface
  next_actions: list[string]       # operations the agent can do next

pending:                           # for risk_level: confirmation, before confirmation is given
  message_template: string
  include: list[string]

validation_error:
  message: string
  include_errors: bool
  next_actions: list[string]

blocked_transition:                # for risk_level: contextual
  message_template: string

low_confidence:                    # for operations involving OCR or inference
  message: string
  include: list[string]
```

---

## Audit structure

```yaml
log: bool
include_fields: list[string]      # fields to include in the audit log
```

---

## How the agent uses the schema

1. **Receives an intent** from the human in natural language
2. **Identifies the operation** by its name or description
3. **Loads the operation's schema**
4. **Extracts fields** from the intent, inferring from context when `infer_from_context: true`
5. **Validates fields** against `input_schema`
6. **Runs `state_guards`** — if one fails, returns a message and stops
7. **Runs `validation_rules`** — if one fails, applies its policy (block / warn / human_confirmation)
8. **Checks `human_confirmation`** — if `risk_level == confirmation`, pauses and waits
9. **Executes the operation**
10. **Runs `side_effects`**
11. **Returns a signpost** with the result, alerts, and `next_actions`

---

## Compatibility map with existing standards

| Standard | Relationship to Agent-Ready Schema |
|--------|-------------------------------|
| OpenAPI | Describes endpoint structure. ARS describes operation semantics. Complementary. |
| MCP | Discovers available tools. ARS governs what each tool is allowed to do. Complementary. |
| JSON Schema | Validates data structure. ARS validates intent + state + risk. ARS includes JSON Schema. |
| XSD (NF-e) | Direct inspiration. ARS generalizes the schema-as-governance concept to any operation. |

---

## Versioning

The `schema_version` field follows a simplified semver: `MAJOR.MINOR`

- `MAJOR` changes on a breaking change
- `MINOR` changes when new optional fields are added

Current version: **0.1** (Draft — subject to change)

---

## Reference implementations

| System | Repository | Status |
|---------|-------------|--------|
| FamilyOS | /schemas/familyos/ | Experimental |

---

*Agent-Ready Schema v0.1 — Diego / Orquestra AI — 2026*
*Inspired by: Felipe Amorim — "The A in API No Longer Means Application"*
*Structural inspiration: Brazil's NF-e XSD*
