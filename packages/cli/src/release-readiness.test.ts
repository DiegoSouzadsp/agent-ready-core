import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel, 'package.json'), 'utf8'));
const pkgs = ['core', 'adapter-mcp', 'adapter-rest', 'adapter-sqlite', 'cli', 'gateway'];

describe('release readiness', () => {
  for (const p of pkgs) {
    const dir = `packages/${p}`;
    const pkg = read(dir);

    it(`${p} has publish metadata`, () => {
      expect(pkg.version).toBe('0.2.0');
      expect(pkg.publishConfig?.access).toBe('public');
      expect(pkg.files).toContain('dist');
    });

    it(`${p} exports point at files in dist`, (ctx) => {
      const distDir = path.join(root, dir, 'dist');
      if (!fs.existsSync(distDir)) ctx.skip();
      const targets = [pkg.exports?.['.']?.types, pkg.exports?.['.']?.import];
      for (const t of targets) {
        expect(typeof t, `${p} exports['.']`).toBe('string');
        expect(fs.existsSync(path.join(root, dir, t)), t).toBe(true);
      }
    });

    it(`${p} has no unpinned internal dependencies`, () => {
      for (const k of ['dependencies', 'peerDependencies', 'devDependencies']) {
        for (const [name, range] of Object.entries<string>(pkg[k] ?? {})) {
          if (!name.startsWith('@agent-ready/')) continue;
          expect(range, `${p} ${k} ${name}`).not.toMatch(/^(\*|file:|workspace:)/);
        }
      }
    });
  }

  it('apps and root are private', () => {
    for (const rel of ['apps/docs', 'apps/playground', '.']) {
      expect(read(rel).private, rel).toBe(true);
    }
  });
});
