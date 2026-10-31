import { DEFAULT_GUARD_PREDICATE } from '@agent-ready/core';
import type { AdapterResolvers } from '@agent-ready/core';
import type { Database } from 'better-sqlite3';

export type SqliteResolverConfig = {
  /**
   * The raw SQL query string, or a custom function that receives the db instance and params.
   * If a string is provided, it must be a SELECT query that returns a value or a DML query.
   */
  [predicateName: string]: string | ((db: Database, params: Record<string, unknown>) => any);
};

function isSelect(query: string): boolean {
  return query.trim().toUpperCase().startsWith('SELECT');
}

function execute(db: Database, query: string, params: Record<string, unknown>) {
  const sql = query.trim();
  const stmt = db.prepare(sql);
  return isSelect(sql) ? stmt.get(params) : stmt.run(params);
}

/**
 * Creates AdapterResolvers for a SQLite database.
 * 
 * @param db The better-sqlite3 database instance
 * @param config Map of predicate names to SQL queries or functions
 * @returns AdapterResolvers ready to be passed to createAdapter()
 */
export function createSqliteResolvers(
  db: Database,
  config: SqliteResolverConfig
): AdapterResolvers {
  const resolvers: AdapterResolvers = {
    // why: lets state_guards run their own SELECT without declaring a named predicate per guard.
    [DEFAULT_GUARD_PREDICATE]: (params: Record<string, unknown>) => {
      const { query, ...rest } = params;
      if (typeof query !== 'string') {
        throw new Error('sql.query requires a "query" string param');
      }
      if (!isSelect(query)) {
        throw new Error('sql.query only runs SELECT statements; a state guard must not write');
      }
      const bind: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (typeof v === 'boolean') bind[k] = v ? 1 : 0;
        else if (v === null || ['string', 'number', 'bigint'].includes(typeof v)) bind[k] = v;
      }
      return execute(db, query, bind);
    },
  };

  for (const [predicateName, handler] of Object.entries(config)) {
    resolvers[predicateName] = (params: Record<string, unknown>) => {
      if (typeof handler === 'function') {
        return handler(db, params);
      }
      return execute(db, handler, params);
    };
  }

  return resolvers;
}

