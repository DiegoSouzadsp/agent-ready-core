/**
 * ARS quickstart: a tiny helpdesk exposed as MCP tools over stdio.
 *
 * Run from the repo root (after `npm install && npm run build`):
 *
 *   npx tsx examples/quickstart/server.ts
 *
 * Data lives in memory and resets on every start. Logs go to stderr only:
 * stdout is the MCP protocol channel and must stay clean.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AgentReady } from '@agent-ready/core';
import { registerArsTools } from '@agent-ready/adapter-mcp';
import type { ExecutorMap } from '@agent-ready/adapter-mcp';
import { fileURLToPath } from 'node:url';

const SCHEMA_PATH = fileURLToPath(new URL('./support-tickets.yml', import.meta.url));

interface Ticket {
  id: number;
  title: string;
  description: string;
  status: 'open' | 'closed';
  priority: 'low' | 'normal' | 'high';
  customer_id: number;
  assignee_id: number | null;
  resolution?: string;
}

// Fictional data only.
const tickets = new Map<number, Ticket>([
  [1, { id: 1, title: 'Cannot reset my password', description: 'Reset email never arrives (jane.doe@example.com).', status: 'open', priority: 'high', customer_id: 1, assignee_id: null }],
  [2, { id: 2, title: 'Invoice shows wrong address', description: 'Billing address is outdated (john.roe@example.com).', status: 'open', priority: 'normal', customer_id: 2, assignee_id: 10 }],
  [3, { id: 3, title: 'Export to CSV is slow', description: 'Resolved after a cache fix (sam.poe@example.com).', status: 'closed', priority: 'low', customer_id: 3, assignee_id: 10, resolution: 'Cache fix deployed' }],
]);
const agents = new Set([10, 11]);
let nextId = 4;

function need(id: unknown): Ticket {
  const t = tickets.get(Number(id));
  if (!t) {
    throw new Error(`Ticket ${id} does not exist. Call list_tickets to see valid ids.`);
  }
  return t;
}

// ARS runs input validation, defaults and the confirmation gate before any
// executor. The state_guards in the YAML describe SQL for a real database; with
// no database here, the executors enforce the same guards in memory.
// delete_ticket is risk_level: confirmation, so its executor is never called.
const executors: ExecutorMap = {
  list_tickets: (input) => {
    const rows = [...tickets.values()].filter((t) => !input.status || t.status === input.status);
    return { count: rows.length, tickets: rows.map((t) => ({ id: t.id, title: t.title, status: t.status })) };
  },
  get_ticket: (input) => ({ ticket: need(input.ticket_id) }),
  create_ticket: (input) => {
    const title = String(input.title);
    const dup = [...tickets.values()].find(
      (t) => t.status === 'open' && t.customer_id === Number(input.customer_id) && t.title === title,
    );
    if (dup) {
      throw new Error(`Customer ${input.customer_id} already has open ticket ${dup.id} with this title. Call get_ticket on it instead.`);
    }
    const t: Ticket = {
      id: nextId++,
      title,
      description: String(input.description ?? ''),
      status: 'open',
      priority: (input.priority as Ticket['priority']) ?? 'normal',
      customer_id: Number(input.customer_id),
      assignee_id: null,
    };
    tickets.set(t.id, t);
    return { ticket_id: t.id, status: t.status, priority: t.priority };
  },
  assign_ticket: (input) => {
    const t = need(input.ticket_id);
    if (t.status !== 'open') {
      throw new Error(`Ticket ${t.id} is closed; only open tickets can be assigned. Call list_tickets with status "open".`);
    }
    if (!agents.has(Number(input.agent_id))) {
      throw new Error(`Agent ${input.agent_id} does not exist. Valid agent ids: ${[...agents].join(', ')}.`);
    }
    t.assignee_id = Number(input.agent_id);
    return { ticket_id: t.id, assignee_id: t.assignee_id };
  },
  close_ticket: (input) => {
    const t = need(input.ticket_id);
    if (t.status !== 'open') {
      throw new Error(`Ticket ${t.id} is already closed. Call list_tickets with status "open".`);
    }
    t.status = 'closed';
    t.resolution = String(input.resolution);
    return { ticket_id: t.id, status: t.status, resolution: t.resolution };
  },
  delete_ticket: (input) => {
    tickets.delete(Number(input.ticket_id));
    return { ticket_id: input.ticket_id, deleted: true };
  },
};

async function main() {
  const agent = await AgentReady.fromFile(SCHEMA_PATH);

  const server = new McpServer({ name: 'ars-quickstart-support-tickets', version: '0.1.0' });
  // reporter_id is infer_from_context: a fixed demo user stands in for "who is asking".
  registerArsTools(server, agent, executors, { context: { reporter_id: 1 } });

  await server.connect(new StdioServerTransport());
  console.error(`[ars-quickstart] serving ${agent.operations.length} operations over stdio`);
}

main().catch((err) => {
  console.error('[ars-quickstart] server error:', err);
  process.exit(1);
});
