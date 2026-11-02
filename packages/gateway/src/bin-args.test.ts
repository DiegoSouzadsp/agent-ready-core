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
  it('returns an empty list when nothing is configured', () => {
    expect(resolveInboundTokens(['--plugin', 'x'], {})).toEqual([]);
    expect(resolveInboundTokens([], { ARS_GATEWAY_TOKENS: ' , ' })).toEqual([]);
  });
});
