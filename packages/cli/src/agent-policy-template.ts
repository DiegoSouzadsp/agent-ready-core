export const AGENT_POLICY_TEMPLATE = `# agent-policy.yml - the operator's side of the governance.
# The schema owner declares each operation's risk_level; this file declares how much
# autonomy YOUR agent gets over those risk levels (free < validated < contextual < confirmation).
agent_policy: "1.0"
name: support-bot            # agent identity (letters, digits, _ . -)
autonomy:
  execute_up_to: validated   # free|validated|contextual: runs on its own up to this level (inclusive)
  ask_up_to: contextual      # above execute_up_to and up to this level: asks a human
  # above ask_up_to: denied. confirmation can never be execute_up_to: it always needs a human.
systems:                     # optional per-system exceptions (MCP server name / plugin / module)
  support-tickets:
    execute_up_to: contextual
    operations:
      delete_ticket: deny    # allow|ask|deny per operation; wins over every ceiling
`;
