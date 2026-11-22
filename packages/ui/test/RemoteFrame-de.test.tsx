/** @vitest-environment jsdom */
// T49 Q-de-strings: the build prefix of a frame is German in DE ("Build"), English otherwise.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteFrame } from '../src/index.ts';

const Ok = () => <p>remote ok</p>;
const frame = () => (
  <RemoteFrame
    name="products"
    port={3001}
    load={() => Promise.resolve({ default: Ok, buildVersion: 'v1' })}
  />
);

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.lang = '';
});

describe('RemoteFrame build prefix', () => {
  it.each([
    ['de', 'Build v1'],
    ['en', 'build v1'],
  ])('Q-de-strings: %s reads "%s"', async (lang, text) => {
    localStorage.setItem('mfe-lab:locale', lang);
    document.documentElement.lang = lang;
    await act(async () => void render(frame()));
    expect((await screen.findByText(text)).classList.contains('remote-frame-build')).toBe(true);
  });
});
