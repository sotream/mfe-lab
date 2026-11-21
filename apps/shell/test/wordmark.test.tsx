/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it } from 'vitest';
import { Wordmark } from '../src/Wordmark.tsx';

afterEach(cleanup);

it('wordmark link keeps its accessible name; the mark is decorative', () => {
  render(
    <MemoryRouter>
      <Wordmark />
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'mfe-lab' });
  expect(link.getAttribute('href')).toBe('/');
  expect(link.textContent).toBe('mfe-lab');
  const svg = link.querySelector('svg');
  expect(svg).not.toBeNull();
  expect(svg!.getAttribute('aria-hidden')).toBe('true');
});
