// Typed event contract between micro frontends (RFC 0006). The bus is the DOM (`window`
// CustomEvent), so each remote may bundle its own copy and they still talk.
// Adding an event = extend EventMap + a changelog line in RFC 0006.
export type EventMap = {
  'products:changed': { id: number; kind: 'created' | 'updated' | 'deleted' };
  'flags:changed': { name: string; enabled: boolean };
};
export type EventName = keyof EventMap;
export type MfeEvent = {
  [N in EventName]: { name: N; detail: EventMap[N]; at: number };
}[EventName];

const ANY = 'mfe:*';

export function emit<N extends EventName>(name: N, detail: EventMap[N]): void {
  window.dispatchEvent(new CustomEvent(`mfe:${name}`, { detail }));
  window.dispatchEvent(new CustomEvent(ANY, { detail: { name, detail, at: Date.now() } }));
}

export function on<N extends EventName>(
  name: N,
  handler: (detail: EventMap[N]) => void,
): () => void {
  const l = (e: Event) => handler((e as CustomEvent<EventMap[N]>).detail);
  window.addEventListener(`mfe:${name}`, l);
  return () => window.removeEventListener(`mfe:${name}`, l);
}

export function onAny(handler: (e: MfeEvent) => void): () => void {
  const l = (e: Event) => handler((e as CustomEvent<MfeEvent>).detail);
  window.addEventListener(ANY, l);
  return () => window.removeEventListener(ANY, l);
}
