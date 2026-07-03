---
title: Validation Engine
description: Strict execution and context interpolation
---

The core of Agent-Ready Schema is the `AgentReady` SDK. It loads schemas and provides a unified interface for checking risks and executing operations.

## Basic Usage

```typescript
import { AgentReady } from '@agent-ready/core';
import { createSqliteResolvers } from '@agent-ready/adapter-sqlite';

const agent = AgentReady.fromFile('./docs/financeiro.yml');

// 1. Setup adapters (the bridge to your real logic)
agent.setupAdapter(
  createSqliteResolvers(db, {
    'registrar_gasto': 'INSERT INTO gastos (descricao, valor) VALUES (@descricao, @valor)'
  })
);

// 2. Validate inputs before running
const input = { descricao: "tv", valor: 600 };
const context = { role: "admin", user_id: 1 };
const operation = agent.getOperation('OP-FIN-01');

const result = await operation.validate(input, context);

if (!result.valid) {
  // Return the signpost to the LLM
  console.log(operation.buildSignpost(result, null));
} else {
  // 3. Execute
  await operation.execute(input, context);
}
```

## Signposts

When validation fails, ARS generates a "Signpost". Instead of simply rejecting the request, a Signpost provides exact instructions for the LLM on how to fix it:

```json
{
  "reason": "Não foi possível registrar o gasto.",
  "what_to_do": "Fix the following fields: descricao",
  "errors": [
    "[descricao] (MIN_LENGTH) Field 'descricao' must be at least 3 characters"
  ],
  "suggestions": [
    "Ask the user to clarify the value of descricao."
  ]
}
```
