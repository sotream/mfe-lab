/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { emit, on, onAny, type MfeEvent } from '../src/index.ts';

const detail = { id: 7, kind: 'created' } as const;

describe('@mfe/events', () => {
  it('Q-events-emit-on: the handler gets the detail', () => {
    const h = vi.fn();
    const off = on('products:changed', h);
    emit('products:changed', detail);
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith(detail);
    off();
  });

  it('Q-events-off: after unsubscribe the handler is not called', () => {
    const h = vi.fn();
    const any = vi.fn();
    const off = on('products:changed', h);
    const offAny = onAny(any);
    off();
    offAny();
    emit('products:changed', detail);
    expect(h).not.toHaveBeenCalled();
    expect(any).not.toHaveBeenCalled();
  });

  it('Q-events-any: onAny gets { name, detail, at: number }', () => {
    const got: MfeEvent[] = [];
    const off = onAny((e) => got.push(e));
    const before = Date.now();
    emit('products:changed', { id: 1, kind: 'deleted' });
    off();
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({
      name: 'products:changed',
      detail: { id: 1, kind: 'deleted' },
      at: expect.any(Number),
    });
    expect(got[0]!.at).toBeGreaterThanOrEqual(before);
    expect(got[0]!.at).toBeLessThanOrEqual(Date.now());
  });

  it('Q-events-dom: a raw window listener receives mfe:<name> and mfe:*', () => {
    const named = vi.fn();
    const star = vi.fn();
    window.addEventListener('mfe:products:changed', named);
    window.addEventListener('mfe:*', star);
    emit('products:changed', detail);
    window.removeEventListener('mfe:products:changed', named);
    window.removeEventListener('mfe:*', star);
    expect(named).toHaveBeenCalledTimes(1);
    expect((named.mock.calls[0]![0] as CustomEvent).detail).toEqual(detail);
    expect(star).toHaveBeenCalledTimes(1);
    expect((star.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      name: 'products:changed',
      detail,
      at: expect.any(Number),
    });
  });

  it('Q-events-types: unknown names and wrong payloads are compile errors', () => {
    const run = () => {
      // @ts-expect-error unknown event name
      emit('nope:x', {});
      // @ts-expect-error wrong payload shape
      emit('products:changed', { id: 'x', kind: 'created' });
      // @ts-expect-error kind outside the union
      emit('products:changed', { id: 1, kind: 'nope' });
      // @ts-expect-error unknown name in on()
      on('nope:x', () => {});
    };
    expect(typeof run).toBe('function'); // never executed: compile-time only
  });
});
