---
title: Adapters
description: Connecting Agent-Ready Schema to the real world
---

Adapters are the execution layer of Agent-Ready Schema. Once the input validation passes and risk policies are respected, adapters do the heavy lifting of interacting with your database or external APIs.

## SQLite Adapter

Install the SQLite Adapter:

```bash
npm install @agent-ready/adapter-sqlite
```

Usage:

```typescript
import { createSqliteResolvers } from '@agent-ready/adapter-sqlite';
import Database from 'better-sqlite3';

const db = new Database('data.db');

const resolvers = createSqliteResolvers(db, {
  'registrar_gasto': 'INSERT INTO gastos (descricao, valor) VALUES (@descricao, @valor)',
  
  // You can also use custom callbacks for complex logic:
  'fechar_mes': (db, params) => {
    // custom typescript logic...
    return db.prepare('UPDATE ...').run(params);
  }
});
```

## REST Adapter

Install the REST Adapter:

```bash
npm install @agent-ready/adapter-rest
```

Usage:

```typescript
import { createRestResolvers } from '@agent-ready/adapter-rest';

const resolvers = createRestResolvers(
  { baseUrl: 'https://api.example.com' },
  {
    'user.get': { method: 'GET', url: '/users/{id}' },
    'user.create': { method: 'POST', url: '/users' },
    
    // You can transform the response JSON before ARS returns it to the LLM
    'weather.current': {
      method: 'GET',
      url: '/weather?q={city}',
      transformResponse: (data) => data.temperature
    }
  }
);
```
