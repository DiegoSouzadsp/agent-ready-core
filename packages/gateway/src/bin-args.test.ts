import { describe, expect, it } from 'vitest';
import { resolveInboundTokenEntries } from './bin-args.js';

const tokens = (argv: string[], env: NodeJS.ProcessEnv) => resolveInboundTokenEntries(argv, env).map((e) => e.token);

describe('resolveInboundTokenEntries - tokens', () => {
  it('reads repeatable --token flags', () => {
    expect(tokens(['--plugin', 'x', '--token', 'a', '--token', 'b'], {})).toEqual(['a', 'b']);
  });
  it('reads a comma separated env value with spaces', () => {
    expect(tokens([], { ARS_GATEWAY_TOKENS: 'a, b' })).toEqual(['a', 'b']);
  });
  it('unions flag and env without duplicates', () => {
    expect(tokens(['--token', 'a'], { ARS_GATEWAY_TOKENS: 'a,b' })).toEqual(['a', 'b']);
  });
  it('rejects a dangling or valueless --token instead of disabling auth', () => {
    expect(() => resolveInboundTokenEntries(['--token'], {})).toThrow('--token requires a value');
    expect(() => resolveInboundTokenEntries(['--token', '--port', '8808'], {})).toThrow('--token requires a value');
    expect(() => resolveInboundTokenEntries(['--token', ' '], {})).toThrow('--token requires a value');
  });
  it('returns an empty list when nothing is configured', () => {
    expect(tokens(['--plugin', 'x'], {})).toEqual([]);
    expect(tokens([], { ARS_GATEWAY_TOKENS: ' , ' })).toEqual([]);
  });
});

describe('resolveInboundTokenEntries', () => {
  it('splits token and profile at the last at sign', () => {
    expect(resolveInboundTokenEntries(['--token', 'a@bot1', '--token', 'b'], {})).toEqual([
      { token: 'a', profile: 'bot1' },
      { token: 'b' },
    ]);
    expect(resolveInboundTokenEntries([], { ARS_GATEWAY_TOKENS: 'a@bot1, b' })).toEqual([
      { token: 'a', profile: 'bot1' },
      { token: 'b' },
    ]);
    expect(resolveInboundTokenEntries(['--token', 'a@bot1'], { ARS_GATEWAY_TOKENS: 'a@bot1,b' })).toEqual([
      { token: 'a', profile: 'bot1' },
      { token: 'b' },
    ]);
    expect(resolveInboundTokenEntries(['--token', 'x@y@bot.1'], {})).toEqual([{ token: 'x@y', profile: 'bot.1' }]);
  });
  it('equals signs and base64 padding stay inside the token', () => {
    expect(resolveInboundTokenEntries(['--token', 'abc=def'], {})).toEqual([{ token: 'abc=def' }]);
    expect(resolveInboundTokenEntries(['--token', 'abc=='], {})).toEqual([{ token: 'abc==' }]);
    expect(resolveInboundTokenEntries(['--token', 'abc==@x1'], {})).toEqual([{ token: 'abc==', profile: 'x1' }]);
    expect(resolveInboundTokenEntries(['--token', 'a@'], {})).toEqual([{ token: 'a@' }]);
  });
  it('an invalid profile suffix is a configuration error and never leaks the secret', () => {
    for (const raw of ['tok@bot!', 'tok@bot:ro', 'supersecret@bad name']) {
      expect(() => resolveInboundTokenEntries(['--token', raw], {})).toThrow(/invalid agent profile/);
      expect(() => resolveInboundTokenEntries(['--token', raw], {})).not.toThrow(/supersecret|tok@/);
    }
    expect(() => resolveInboundTokenEntries([], { ARS_GATEWAY_TOKENS: 'a@bad!' })).toThrow(/invalid agent profile/);
  });
  it('conflicting profiles for one token fail', () => {
    const args = ['--token', 'secret-a@x', '--token', 'secret-a@y'];
    expect(() => resolveInboundTokenEntries(args, {})).toThrow(/conflicting agent profiles/);
    expect(() => resolveInboundTokenEntries(args, {})).not.toThrow(/secret-a/);
    expect(() => resolveInboundTokenEntries(['--token'], {})).toThrow('--token requires a value');
  });
});
