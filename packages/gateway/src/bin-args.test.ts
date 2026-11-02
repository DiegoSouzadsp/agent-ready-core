import { describe, expect, it } from 'vitest';
import { resolveInboundTokenEntries, resolveInboundTokens } from './bin-args.js';

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

describe('resolveInboundTokenEntries', () => {
  it('splits token and profile at the last equals sign', () => {
    expect(resolveInboundTokenEntries(['--token', 'a=bot1', '--token', 'b'], {})).toEqual([
      { token: 'a', profile: 'bot1' },
      { token: 'b' },
    ]);
    expect(resolveInboundTokenEntries([], { ARS_GATEWAY_TOKENS: 'a=bot1, b' })).toEqual([
      { token: 'a', profile: 'bot1' },
      { token: 'b' },
    ]);
    expect(resolveInboundTokenEntries(['--token', 'a=bot1'], { ARS_GATEWAY_TOKENS: 'a=bot1,b' })).toEqual([
      { token: 'a', profile: 'bot1' },
      { token: 'b' },
    ]);
  });
  it('keeps base64 padding inside the token', () => {
    expect(resolveInboundTokenEntries(['--token', 'abc=='], {})).toEqual([{ token: 'abc==' }]);
    expect(resolveInboundTokenEntries(['--token', 'abc==x1'], {})).toEqual([{ token: 'abc=', profile: 'x1' }]);
    expect(resolveInboundTokenEntries(['--token', 'a='], {})).toEqual([{ token: 'a=' }]);
  });
  it('resolveInboundTokens still returns tokens only', () => {
    expect(resolveInboundTokens(['--token', 'a=bot1', '--token', 'b'], {})).toEqual(['a', 'b']);
  });
  it('conflicting profiles for one token fail', () => {
    expect(() => resolveInboundTokenEntries(['--token', 'secret-a=x', '--token', 'secret-a=y'], {})).toThrow(/conflicting agent profiles/);
    try {
      resolveInboundTokenEntries(['--token', 'secret-a=x', '--token', 'secret-a=y'], {});
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-a');
    }
    expect(() => resolveInboundTokenEntries(['--token'], {})).toThrow('--token requires a value');
  });
});
