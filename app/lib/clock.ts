import { useSyncExternalStore } from 'react';

/**
 * O tempo do vídeo, fora do estado do React. A reproduzir muda a cada
 * fotograma: só volta a desenhar-se quem o lê, não o editor inteiro.
 */
let now = 0;
const listeners = new Set<() => void>();

export const clock = {
  get: () => now,
  set: (t: number) => {
    if (t === now) return;
    now = t;
    listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** O tempo, ou só o que dele interessa: com `pick`, só redesenha quando o resultado muda. */
export function useClock(): number;
export function useClock<T>(pick: (t: number) => T): T;
export function useClock<T>(pick?: (t: number) => T) {
  const snapshot = () => (pick ? pick(now) : now);
  return useSyncExternalStore(clock.subscribe, snapshot, snapshot);
}
