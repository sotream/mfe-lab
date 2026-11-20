/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fresh = async () => {
  vi.resetModules();
  const log = await import('../src/eventLog.ts');
  const { emit } = await import('@mfe/events');
  log.startEventLog();
  return { ...log, emit };
};
beforeEach(() => vi.resetModules());

describe('eventLog', () => {
  it('Q-log-order: newest first', async () => {
    const { eventLog, emit } = await fresh();
    emit('products:changed', { id: 1, kind: 'created' });
    emit('products:changed', { id: 2, kind: 'updated' });
    emit('products:changed', { id: 3, kind: 'deleted' });
    expect(eventLog().map((e) => (e.name === 'products:changed' ? e.detail.id : -1))).toEqual([
      3, 2, 1,
    ]);
    expect(eventLog()[0]!.name).toBe('products:changed');
  });

  it('Q-log-cap: 25 emits keep the newest 20', async () => {
    const { eventLog, emit } = await fresh();
    for (let id = 1; id <= 25; id++) emit('products:changed', { id, kind: 'created' });
    const ids = eventLog().map((e) => (e.name === 'products:changed' ? e.detail.id : -1));
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe(25);
    expect(ids[19]).toBe(6);
  });

  it('Q-log-idempotent: startEventLog twice gives no duplicates', async () => {
    const { eventLog, startEventLog, emit } = await fresh();
    startEventLog();
    startEventLog();
    emit('products:changed', { id: 1, kind: 'created' });
    expect(eventLog()).toHaveLength(1);
  });

  it('Q-log-subscribe: the listener is called on a new event, not after unsubscribe', async () => {
    const { subscribeEventLog, eventLog, emit } = await fresh();
    const l = vi.fn();
    const off = subscribeEventLog(l);
    emit('products:changed', { id: 1, kind: 'created' });
    expect(l).toHaveBeenCalledTimes(1);
    expect(eventLog()).toHaveLength(1);
    off();
    emit('products:changed', { id: 2, kind: 'created' });
    expect(l).toHaveBeenCalledTimes(1);
  });
});
