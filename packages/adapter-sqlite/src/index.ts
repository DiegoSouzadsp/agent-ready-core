import type { AdapterResolvers } from '@agent-ready/core';
import type { Database } from 'better-sqlite3';

export type SqliteResolverConfig = {
  /**
   * The raw SQL query string, or a custom function that receives the db instance and params.
   * If a string is provided, it must be a SELECT query that returns a value or a DML query.
   */
  [predicateName: string]: string | ((db: Database, params: Record<string, unknown>) => any);
};

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
  const resolvers: AdapterResolvers = {};

  for (const [predicateName, handler] of Object.entries(config)) {
    resolvers[predicateName] = (params: Record<string, unknown>) => {
      if (typeof handler === 'function') {
        return handler(db, params);
      }

      // If it's a string, we prepare and execute.
      // We assume it's a SELECT if it starts with SELECT, returning the first row.
      const queryStr = handler.trim();
      const stmt = db.prepare(queryStr);
      
      if (queryStr.toUpperCase().startsWith('SELECT')) {
        return stmt.get(params);
      }
      
      return stmt.run(params);
    };
  }

  return resolvers;
}

