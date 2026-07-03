import type { AdapterResolvers } from './types.js';

export type { AdapterResolvers };

// ─────────────────────────────────────────────
// Adapter interface
// ─────────────────────────────────────────────

/** The Adapter interface — wraps resolvers with error handling */
export interface Adapter {
  /**
   * Resolve a predicate against the backend.
   * @throws {AdapterError} If the resolver throws or is not found
   */
  resolve(predicateName: string, params: Record<string, unknown>): Promise<unknown>;
  /** Check if a resolver exists for the given predicate name */
  has(predicateName: string): boolean;
  /** List all registered predicate names */
  list(): string[];
}

// ─────────────────────────────────────────────
// AdapterError
// ─────────────────────────────────────────────

/** Error thrown when an adapter resolver fails */
export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly predicateName: string,
    public readonly params: Record<string, unknown>,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

// ─────────────────────────────────────────────
// Factory functions
// ─────────────────────────────────────────────

/**
 * Create an Adapter from a map of resolver functions.
 * Resolvers are isolated — errors from one don't crash others.
 *
 * @example
 * const adapter = createAdapter({
 *   'month.is_open': async ({ ano, mes }) => {
 *     const row = db.prepare('SELECT fechado FROM meses WHERE ano=? AND mes=?').get(ano, mes);
 *     return !row?.fechado;
 *   },
 *   'entity.exists': async ({ table, id }) => {
 *     return db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id) !== undefined;
 *   }
 * });
 */
export function createAdapter(resolvers: AdapterResolvers): Adapter {
  return {
    async resolve(predicateName, params) {
      const resolver = resolvers[predicateName];
      if (!resolver) {
        throw new AdapterError(
          `[agent-ready/adapter] No resolver registered for predicate "${predicateName}"`,
          predicateName,
          params,
        );
      }
      try {
        return await Promise.resolve(resolver(params));
      } catch (err) {
        throw new AdapterError(
          `[agent-ready/adapter] Resolver "${predicateName}" failed: ${(err as Error).message}`,
          predicateName,
          params,
          err,
        );
      }
    },
    has(predicateName) {
      return predicateName in resolvers;
    },
    list() {
      return Object.keys(resolvers);
    },
  };
}

/**
 * Create a no-op adapter that always returns undefined.
 * Use when no adapter is provided — state guards won't be resolved.
 */
export function noopAdapter(): Adapter {
  return {
    async resolve(predicateName) {
      return undefined;
    },
    has() {
      return false;
    },
    list() {
      return [];
    },
  };
}
