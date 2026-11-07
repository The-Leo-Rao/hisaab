export const HOLD_HAND = 2.2;
export const MORPH = 5;
export const HOLD_COIN = 2.8;
export const CYCLE = HOLD_HAND + MORPH + HOLD_COIN + MORPH;

const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

export function morphAt(seconds: number): number {
  const t = ((seconds % CYCLE) + CYCLE) % CYCLE;
  if (t < HOLD_HAND) return 0;
  if (t < HOLD_HAND + MORPH) return smoother((t - HOLD_HAND) / MORPH);
  if (t < HOLD_HAND + MORPH + HOLD_COIN) return 1;
  return 1 - smoother((t - HOLD_HAND - MORPH - HOLD_COIN) / MORPH);
}

export function lightAt(seconds: number): number {
  return ((seconds % CYCLE) / CYCLE) * Math.PI * 2;
}
