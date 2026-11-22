// T49 amendments 14 and 15 on the CSS source: locked controls look disabled, the demo chip does not use the red token.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const files = [
  ...readdirSync(join(root, 'packages/ui/src'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => join(root, 'packages/ui/src', f)),
  join(root, 'apps/shell/src/styles.css'),
];
const css = files.map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');

// Declarations of every plain rule whose selector list satisfies `match`.
const ruleBodies = (match: (sel: string) => boolean): string[] => {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css))
    if (m[1]!.split(',').some((s) => match(s.trim()))) out.push(m[2]!);
  return out;
};

describe('disabled controls (amendment 14)', () => {
  it('Q-disabled-style: disabled inputs, selects and switches get cursor: not-allowed', () => {
    for (const control of ['input', 'select', 'switch']) {
      const bodies = ruleBodies(
        (s) =>
          (s.includes(':disabled') || s.includes('[aria-disabled')) &&
          s.includes(control === 'select' ? 'select' : control),
      );
      expect(
        bodies.some((b) => /cursor:\s*not-allowed/.test(b)),
        `${control}:disabled has cursor: not-allowed`,
      ).toBe(true);
    }
  });

  it('Q-disabled-style: the disabled rule changes the colour or border, not only the cursor', () => {
    const bodies = ruleBodies((s) => s.includes(':disabled') && /input|select|switch/.test(s));
    expect(
      bodies.some((b) => /(color|border|background|opacity)/.test(b.replace(/cursor:[^;]+;?/, ''))),
    ).toBe(true);
  });

  it('Q-disabled-style: input and select text does not rely on opacity below 0.5 (WCAG 1.4.3)', () => {
    for (const b of ruleBodies((s) => s.includes(':disabled') && /input|select/.test(s))) {
      const o = /opacity:\s*([\d.]+)/.exec(b);
      if (o) expect(Number(o[1])).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('demo chip (amendment 15)', () => {
  it('Q-demo-chip: .chip--demo is neutral or amber, not the error colour', () => {
    const bodies = ruleBodies((s) => s === '.chip--demo');
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b).not.toMatch(/--ds1-bad|red|danger|error/i);
      expect(b).toMatch(/color/);
    }
  });
});
