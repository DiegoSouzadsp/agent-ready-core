import { describe, it, expect, vi } from 'vitest';
import { createSqliteResolvers } from '../src/index.js';
import type { Database } from 'better-sqlite3';

// Mock DB interface
const mockDb = {
  prepare: vi.fn(),
} as unknown as Database;

describe('createSqliteResolvers', () => {
  it('executes raw SELECT queries via prepare().get()', () => {
    const mockStmt = { get: vi.fn().mockReturnValue({ id: 1 }) };
    vi.mocked(mockDb.prepare).mockReturnValue(mockStmt as any);

    const resolvers = createSqliteResolvers(mockDb, {
      'month.is_open': 'SELECT 1 FROM months WHERE id = @id'
    });

    const result = resolvers['month.is_open']({ id: 1 });
    expect(mockDb.prepare).toHaveBeenCalledWith('SELECT 1 FROM months WHERE id = @id');
    expect(mockStmt.get).toHaveBeenCalledWith({ id: 1 });
    expect(result).toEqual({ id: 1 });
  });

  it('executes raw DML queries via prepare().run()', () => {
    const mockStmt = { run: vi.fn().mockReturnValue({ changes: 1 }) };
    vi.mocked(mockDb.prepare).mockReturnValue(mockStmt as any);

    const resolvers = createSqliteResolvers(mockDb, {
      'user.insert': 'INSERT INTO users VALUES (@name)'
    });

    const result = resolvers['user.insert']({ name: 'Diego' });
    expect(mockDb.prepare).toHaveBeenCalledWith('INSERT INTO users VALUES (@name)');
    expect(mockStmt.run).toHaveBeenCalledWith({ name: 'Diego' });
    expect(result).toEqual({ changes: 1 });
  });

  it('executes callback function if provided', () => {
    const fn = vi.fn().mockReturnValue('custom_result');
    const resolvers = createSqliteResolvers(mockDb, {
      'custom.logic': fn
    });

    const params = { id: 1 };
    const result = resolvers['custom.logic'](params);
    
    expect(fn).toHaveBeenCalledWith(mockDb, params);
    expect(result).toBe('custom_result');
  });
});

