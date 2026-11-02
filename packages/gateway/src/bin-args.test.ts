import { describe, expect, it } from 'vitest';
import { resolveInboundTokens } from './bin-args.js';

describe('resolveInboundTokens', () => {
  it('reads repeatable --token flags', () => {
    expect(resolveInboundTokens(['--plugin', 'x', '--token', 'a', '--token', 'b'], {})).toEqual(['a', 'b']);
  });
  it('reads a comma separated env value with spaces', () => {
    expect(resolveInboundTokens([], { ARS_GATEWAY_TOKENS: 'a, b' })).toEqual(['a', 'b']);
  });
  it('unions flag and env without duplicates', () => {
    expect(resolveInboundTokens(['--token', 'a'], { ARS_GATEWAY_TOKENS: 'a,b' })).toEqual(['a', 'b']);
  });
  it('rejects a dangling or valueless --token instead of disabling auth', () => {
    expect(() => resolveInboundTokens(['--token'], {})).toThrow('--token requires a value');
    expect(() => resolveInboundTokens(['--token', '--port', '8808'], {})).toThrow('--token requires a value');
    expect(() => resolveInboundTokens(['--token', ' '], {})).toThrow('--token requires a value');
  });
  it('returns an empty list when nothing is configured', () => {
    expect(resolveInboundTokens(['--plugin', 'x'], {})).toEqual([]);
    expect(resolveInboundTokens([], { ARS_GATEWAY_TOKENS: ' , ' })).toEqual([]);
  });
});
