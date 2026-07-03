import { describe, it, expect, vi } from 'vitest';
import { createRestResolvers } from '../src/index.js';

describe('createRestResolvers', () => {
  it('calls fetch with correct URL and query params for GET', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ success: true }),
    });

    const resolvers = createRestResolvers(
      { baseUrl: 'https://api.example.com', fetchFn: mockFetch as any },
      {
        'user.get': { method: 'GET', url: '/users/{id}' }
      }
    );

    const result = await resolvers['user.get']({ id: 123, active: true });
    
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/users/123?active=true', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    expect(result).toEqual({ success: true });
  });

  it('calls fetch with correct URL and body for POST', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ created: true }),
    });

    const resolvers = createRestResolvers(
      { baseUrl: 'https://api.example.com', fetchFn: mockFetch as any },
      {
        'user.create': { method: 'POST', url: '/users' }
      }
    );

    const result = await resolvers['user.create']({ name: 'Diego', age: 30 });
    
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Diego', age: 30 }),
    });
    expect(result).toEqual({ created: true });
  });

  it('uses transformResponse if provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ data: { user: 'Diego' } }),
    });

    const resolvers = createRestResolvers(
      { baseUrl: 'https://api.example.com', fetchFn: mockFetch as any },
      {
        'user.get': { 
          method: 'GET', 
          url: '/users/1',
          transformResponse: (data) => data.data.user
        }
      }
    );

    const result = await resolvers['user.get']({});
    expect(result).toBe('Diego');
  });

  it('executes custom function if provided', async () => {
    const fn = vi.fn().mockResolvedValue('custom');
    const resolvers = createRestResolvers(
      { baseUrl: 'https://api.example.com' },
      { 'custom.op': fn }
    );

    const result = await resolvers['custom.op']({ x: 1 });
    expect(fn).toHaveBeenCalledWith({ x: 1 }, { baseUrl: 'https://api.example.com' });
    expect(result).toBe('custom');
  });

  it('throws on HTTP error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
    });

    const resolvers = createRestResolvers(
      { baseUrl: 'http://localhost', fetchFn: mockFetch as any },
      { 'bad.op': { method: 'GET', url: '/missing' } }
    );

    await expect(resolvers['bad.op']({})).rejects.toThrow('HTTP error 404');
  });
});
