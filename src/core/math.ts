/**
 * Pure math helpers shared by the motion system.
 * No three.js / DOM dependency so they stay unit-testable.
 */

export const clamp = (x: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, x));

export const clamp01 = (x: number): number => clamp(x, 0, 1);

/** classic smoothstep, safe when edges are equal */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** deterministic 32-bit PRNG — same seed gives the same particle layout every run */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Catmull-Rom interpolation over `[time, value]` keys.
 * Used for camera choreography so the move stays continuous and soft.
 */
export function keyframe(keys: ReadonlyArray<readonly [number, number]>, time: number): number {
  const n = keys.length;
  if (n === 0) return 0;
  if (time <= keys[0][0]) return keys[0][1];
  if (time >= keys[n - 1][0]) return keys[n - 1][1];

  let i = 0;
  while (i < n - 2 && time > keys[i + 1][0]) i++;

  const t0 = keys[i][0];
  const t1 = keys[i + 1][0];
  const u = clamp01((time - t0) / Math.max(t1 - t0, 1e-6));

  const p0 = keys[Math.max(i - 1, 0)][1];
  const p1 = keys[i][1];
  const p2 = keys[i + 1][1];
  const p3 = keys[Math.min(i + 2, n - 1)][1];

  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

/** 00.00 style timecode for the transport */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const whole = Math.floor(s);
  const hundredths = Math.floor((s - whole) * 100);
  return `${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}
