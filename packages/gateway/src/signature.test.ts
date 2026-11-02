import { describe, it, expect } from 'vitest';
import { signArsRequest } from './signature.js';

describe('signArsRequest', () => {
  it('known-answer vectors fix the v1 format', () => {
    expect(
      signArsRequest({
        secret: 's3cret',
        timestamp: 1700000000000,
        method: 'GET',
        pathAndQuery: '/api/items?q=betoneira',
        body: '',
        operation: 'listar_itens',
        decision: 'executed',
      }),
    ).toBe('v1=0cda2c9edefa8ceb83ee4da7cd5870895a1cea1ddebac27ca2f816a070e69398');
    expect(
      signArsRequest({
        secret: 's3cret',
        timestamp: 1700000000000,
        method: 'POST',
        pathAndQuery: '/api/items',
        body: '{"a":1}',
        operation: 'criar_item',
        decision: 'confirmed',
      }),
    ).toBe('v1=d68695ce27dfe390fbb5c9009bdb3ff0464b3a16269e094939fe4c4c18b528bd');
  });
});
