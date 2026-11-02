# ARS quickstart: support tickets

A small helpdesk exposed to an AI agent as MCP tools, governed by an Agent-Ready Schema. Data is in memory (three fictional tickets) and resets on every start, so you can break things freely.

## What it shows

One operation per risk level, all declared in [`support-tickets.yml`](./support-tickets.yml):

| Risk level | Operation | What to notice |
|---|---|---|
| `free` | `list_tickets` | Returns a summary, not the whole table; `get_ticket` is the drill-down. |
| `validated` | `create_ticket` | Fields are validated before anything runs (title length, required customer, enum priority). |
| `contextual` | `assign_ticket`, `close_ticket` | State guards ("ticket is open", "agent exists"); closing with a refund above 100 asks for a human. |
| `confirmation` | `delete_ticket` | Asks a human through MCP elicitation when the client supports it, otherwise returns `pending`. Without approval it does not execute. |

Important: `confirmation` never runs on the agent's say-so. With an elicitation-capable client the human gets a prompt, and only `accept` with `confirm: true` runs the executor. With any other client the server answers "pending" and the executor for `delete_ticket` is not called; approving it is then the host's job.

## Run it

From the repo root:

```bash
npm install
npm run build
npx ars validate examples/quickstart/support-tickets.yml
npx tsx examples/quickstart/server.ts
```

The server speaks MCP over stdio and prints only to stderr. You will see `serving 6 operations over stdio`. `npx` downloads `tsx` on first run.

## Connect it

**Claude Desktop**: add this to `claude_desktop_config.json` (use your absolute path), then restart the app.

```json
{
  "mcpServers": {
    "support-tickets": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/agent-ready-core/examples/quickstart/server.ts"]
    }
  }
}
```

**Claude Code**: from the repo root run

```bash
claude mcp add support-tickets -- npx tsx examples/quickstart/server.ts
```

or put the same `command`/`args` in a `.mcp.json` file in the project root, in the same shape as the Desktop snippet above (relative path is fine when Claude Code is started from the repo root).

**Cursor** (not yet verified in Cursor): add the same server to `.cursor/mcp.json` in the project, or to `~/.cursor/mcp.json` for all projects (use your absolute path).

```json
{
  "mcpServers": {
    "support-tickets": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/agent-ready-core/examples/quickstart/server.ts"]
    }
  }
}
```

Any MCP client that can launch a stdio server (Cursor included) works the same way: give it the command `npx` and the args above. Elicitation (the real confirmation prompt) only happens in a client that supports it; in the others `delete_ticket` stays `pending` and nothing is deleted. I have not checked which clients support elicitation, so run the smoke test below or "Delete ticket 1." to see which outcome you get.

## Three prompts to try

1. **Free:** "List open tickets."
   Expect `list_tickets` to run immediately and return ids and titles of tickets 1 and 2 only, as JSON in the text of the result. Ticket 3 is closed.
2. **Validated, with an error:** "Create a ticket without a title."
   Expect an error result (not a protocol error) with `Reason`, `What to do` and one line per failing field (`title`). Nothing is created. A good agent then asks you for a title and retries.
3. **Confirmation:** "Delete ticket 1."
   Expect one of two outcomes. A client with elicitation shows a confirmation prompt: accept deletes ticket 1, decline leaves it. A client without elicitation gets a `pending` answer ("This will permanently delete ticket 1. A human must approve before it runs.") and no deletion. Ask "list tickets" afterwards to see which one happened.

Also try "assign ticket 3 to agent 10" (blocked: ticket 3 is closed) and "close ticket 1, refund 500" (pending: refund above 100 needs a human).

## Add an agent policy

[`agent-policy.yml`](./agent-policy.yml) is the operator's side: it says how far one agent (`support-bot`) may go on these operations. It executes up to `validated`, asks at `contextual`, and never runs `delete_ticket`. Generate your own with `npx ars agent init`, and export the Claude Code hook with the policy embedded:

```bash
npx ars hooks export examples/quickstart/support-tickets.yml --target claude-code --server support-tickets --agent-policy examples/quickstart/agent-policy.yml --out .claude/ars
```

Merge `.claude/ars/settings.snippet.json` into `.claude/settings.json` and register the server as `support-tickets`. What changes in the prompts above, in Claude Code with this hook:

1. "List open tickets." runs without a prompt (as without the policy).
2. "Create a ticket without a title." is allowed, and the validation error comes back as before. (`create_ticket` is `validated`, within `execute_up_to`.)
3. "Delete ticket 1." is refused by the hook before the server is called, with the reason "agent policy support-bot denies delete_ticket explicitly". Without the policy it would ask a human.

"Assign ticket 3 to agent 10" now makes the hook ask a human before the server runs. The hook does not evaluate field-level triggers such as the refund above 100, which only the server-side pipeline sees. The key under `systems` in `agent-policy.yml` is `support-tickets`; the hook takes it from `--server`, or from `--system <name>` when it differs from the server name. If `systems` has keys and none matches, the hook and the gateway warn on stderr and use the global `autonomy`. Policies also work in the gateway, one profile per token (`--token <t>@support-bot`, with the plugin name as the key): see the root README, "Two-sided governance".

## Sanity check

```bash
node examples/quickstart/smoke.mjs
```

Spawns the server, performs the MCP handshake, prints the tool list with each `[risk: ...]` tag, and calls `list_tickets`, `create_ticket` (invalid) and `delete_ticket`. Use it to check the setup before wiring a client.

## Known limits

- The tool list has a seventh tool, `get_operation_contract`, which returns the full contract of an operation. It is added by the adapter.
- `server.ts` passes no `resolvers`, so the pipeline does not enforce `state_guards`: the tool description says they are declared and not enforced, and a warning goes to stderr at startup.
- Audit is off unless `ARS_AUDIT=stderr` is set or an `onAudit` sink is passed.
- `state_guards` and `validation_rules` carry SQL that needs a database adapter. Here there is none, so the in-memory executors in `server.ts` enforce the same rules by hand.
