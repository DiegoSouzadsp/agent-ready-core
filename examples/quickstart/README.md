# ARS quickstart: support tickets

A small helpdesk exposed to an AI agent as MCP tools, governed by an Agent-Ready Schema. Data is in memory (three fictional tickets) and resets on every start, so you can break things freely.

## What it shows

One operation per risk level, all declared in [`support-tickets.yml`](./support-tickets.yml):

| Risk level | Operation | What to notice |
|---|---|---|
| `free` | `list_tickets` | Returns a summary, not the whole table; `get_ticket` is the drill-down. |
| `validated` | `create_ticket` | Fields are validated before anything runs (title length, required customer, enum priority). |
| `contextual` | `assign_ticket`, `close_ticket` | State guards ("ticket is open", "agent exists"); closing with a refund above 100 asks for a human. |
| `confirmation` | `delete_ticket` | Returns `pending` and **never executes**. |

Important: `confirmation` does not run the operation. The server answers "pending" and stops; the executor for `delete_ticket` is never called. Approving it is the host's job, not the agent's.

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

## Three prompts to try

1. **Free:** "List open tickets."
   Expect `list_tickets` to run immediately and return ids and titles of tickets 1 and 2 only. Ticket 3 is closed.
2. **Validated, with an error:** "Create a ticket without a title."
   Expect the call to be rejected before anything is created, with an error naming the missing fields (`title`, and `reporter_id`). A good agent then asks you for a title and retries.
3. **Confirmation:** "Delete ticket 1."
   Expect a `pending` answer ("This will permanently delete ticket 1. A human must approve before it runs.") and no deletion. Ask "list tickets" afterwards: ticket 1 is still there.

Also try "assign ticket 3 to agent 10" (blocked: ticket 3 is closed) and "close ticket 1, refund 500" (pending: refund above 100 needs a human).

## Sanity check

```bash
node examples/quickstart/smoke.mjs
```

Spawns the server, performs the MCP handshake, prints the tool list with each `[risk: ...]` tag, and calls `list_tickets`, `create_ticket` (invalid) and `delete_ticket`. Use it to check the setup before wiring a client.

## Known limits

- The tool list has a seventh tool, `get_operation_contract`, which returns the full contract of an operation. It is added by the adapter.
- `list_tickets` puts its rows in the response's `structuredContent`; the plain text line only says it succeeded. Clients that show only the text part will not display the rows.
- `state_guards` and `validation_rules` carry SQL that needs a database adapter. Here there is none, so the in-memory executors in `server.ts` enforce the same rules by hand.
