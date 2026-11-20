import { onAny, type MfeEvent } from '@mfe/events';

const MAX = 20;
let log: readonly MfeEvent[] = [];
let started = false;
const listeners = new Set<() => void>();

// Module-level so the log survives route changes; in memory, so a reload resets it.
export function startEventLog(): void {
  if (started) return;
  started = true;
  onAny((e) => {
    log = [e, ...log].slice(0, MAX);
    listeners.forEach((l) => l());
  });
}

export const eventLog = (): readonly MfeEvent[] => log;

export function subscribeEventLog(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
