export const INIT_TEMPLATE = `# Agent-Ready Schema: one file that declares what an agent may do and under which rules.
schema_version: "0.1"
module: tickets
system: my-system
updated_at: "2026-01-01"

operations:

  # Level 1 (free): read-only, the agent runs it immediately.
  - id: OP-TKT-01
    name: list_tickets
    description: List tickets as a short summary (id, title, status). Use get_ticket for details.
    risk_level: free
    autonomy_policy: execute_immediately

    # Each input field declares its type and constraints; the runtime rejects anything else.
    input_schema:
      status:
        type: enum
        values: [open, closed]
        required: false
        description: "Filter by status. Omit to list all."

    # Return only a summary and point the agent to the operation that fetches details.
    response_strategy:
      mode: summary
      detail_operation: get_ticket

    # Signpost tells the agent what to do next after each outcome.
    signpost:
      success:
        include: [count, tickets]
        next_actions:
          - operation: get_ticket
            reason: "Fetch the full details of one ticket from this list."

    audit:
      log: false

  # Level 2 (validated): writes data, so inputs and business rules are checked first.
  - id: OP-TKT-02
    name: create_ticket
    description: Open a new support ticket for a customer
    risk_level: validated
    autonomy_policy: execute_after_validation

    input_schema:
      title:
        type: string
        required: true
        min_length: 5
        max_length: 120
        description: "Short summary of the problem"
      customer_id:
        type: int
        required: true
        # A foreign key makes the runtime check the referenced row exists.
        foreign_key:
          table: customers

    # Validation rules are queries that must hold before the operation runs.
    validation_rules:
      - id: no_duplicate_open_title
        description: The customer must not already have an open ticket with the same title
        query: "SELECT id FROM tickets WHERE customer_id = :customer_id AND title = :title AND status = 'open'"
        assert_empty: true
        on_fail:
          policy: block
          message: "This customer already has an open ticket with the same title."
          suggest: list_tickets

    signpost:
      success:
        include: [ticket_id, status]
        next_actions:
          - operation: assign_ticket
            reason: "A new ticket starts unassigned; assign it to an agent."

    # Audit records the listed fields for every call of this operation.
    audit:
      log: true
      include_fields: [customer_id]

  # Level 3 (contextual): allowed only when the current system state permits it.
  - id: OP-TKT-03
    name: assign_ticket
    description: Assign an open ticket to a support agent
    risk_level: contextual
    autonomy_policy: validate_state_then_execute

    input_schema:
      ticket_id:
        type: int
        required: true
        foreign_key:
          table: tickets
      agent_id:
        type: int
        required: true

    # State guards are checked against live state; "predicate" names the adapter resolver, "query" is its SQL.
    state_guards:
      - description: Ticket is open
        predicate: sql.query
        query: "SELECT status FROM tickets WHERE id = :ticket_id"
        assert:
          status: open
        on_fail:
          message: "Only open tickets can be assigned."
          suggest: list_tickets

    signpost:
      success:
        include: [ticket_id, assignee_id]
        next_actions:
          - operation: list_tickets
            reason: "Check what is still open."

    audit:
      log: true
      include_fields: [ticket_id, agent_id]

  # Level 4 (confirmation): irreversible, a human must approve before it runs.
  - id: OP-TKT-04
    name: delete_ticket
    description: Permanently delete a ticket. Irreversible.
    risk_level: confirmation
    autonomy_policy: require_explicit_confirmation

    input_schema:
      ticket_id:
        type: int
        required: true
        foreign_key:
          table: tickets

    # The message shown to the human who must approve.
    human_confirmation:
      required: true
      message_template: "This will permanently delete ticket {{ticket_id}}. A human must approve before it runs."

    signpost:
      success:
        message: "Ticket deleted."
        next_actions:
          - operation: list_tickets
            reason: "See the remaining tickets."

    audit:
      log: true
      include_fields: [ticket_id]
`;
