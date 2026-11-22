/** @vitest-environment jsdom */
// Q-truncate: MiddleTruncate renders aria-hidden head and tail pieces plus one visually hidden full text.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MiddleTruncate } from '../src/index.ts';

beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.showPopover ??= vi.fn();
  proto.hidePopover ??= vi.fn();
});
afterEach(cleanup);

const URL_ = 'https://mfe-lab-products.vercel.app/releases/1.2.0/mf-manifest.json';

function pieces(container: HTMLElement) {
  const [head = '', tail = ''] = [...container.querySelectorAll('[aria-hidden="true"]')].map(
    (e) => e.textContent ?? '',
  );
  return { head, tail };
}

describe('MiddleTruncate', () => {
  it('Q-truncate: the default tail is the last-/ segment', () => {
    const { container } = render(<MiddleTruncate text={URL_} />);
    const { head, tail } = pieces(container);
    expect(tail).toBe('/mf-manifest.json');
    expect(head).toBe('https://mfe-lab-products.vercel.app/releases/1.2.0');
  });

  it('Q-truncate: a numeric tail is the last N characters', () => {
    const { container } = render(<MiddleTruncate text={URL_} tail={5} />);
    expect(pieces(container)).toEqual({ head: URL_.slice(0, -5), tail: '.json' });
  });

  it('Q-truncate: no / falls back to the last 12 characters', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const { container } = render(<MiddleTruncate text={text} />);
    expect(pieces(container)).toEqual({ head: text.slice(0, -12), tail: text.slice(-12) });
  });

  it('Q-truncate: a tail longer than half the text falls back to the last 12 characters', () => {
    const text = 'ab/cdefghijklmnopqrstuvwxyz0123'; // last-/ segment is 28 of 31 characters
    const { container } = render(<MiddleTruncate text={text} />);
    expect(pieces(container)).toEqual({ head: text.slice(0, -12), tail: text.slice(-12) });
  });

  it('Q-truncate: head + tail equal the full text, for every tail rule', () => {
    for (const [text, tail] of [
      [URL_, undefined],
      [URL_, 8],
      ['no-slash-at-all-in-this-string', undefined],
      ['a/bcdefghijklmnopqrstuvwxyz', undefined],
    ] as const) {
      const { container, unmount } = render(<MiddleTruncate text={text} tail={tail} />);
      const { head, tail: t } = pieces(container);
      expect(head + t).toBe(text);
      unmount();
    }
  });

  it('Q-truncate: the visible pieces are aria-hidden, one non-hidden element carries the full text', () => {
    const { container } = render(<MiddleTruncate text={URL_} />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    // the full text is also the (hidden) tooltip content: pick the visually-hidden copy
    const full = screen.getAllByText(URL_).filter((e) => e.closest('[role="tooltip"]') === null);
    expect(full).toHaveLength(1);
    expect(full[0]!.closest('[aria-hidden="true"]')).toBeNull();
  });
});
