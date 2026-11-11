/**
 * The 15 second score.
 *
 *   0 ────── 3 ──────── 7 ──────── 11 ──────── 15
 *   ZERO     ENDLESS    AGAIN      ZEA
 *
 * Everything visual (layers, morph weights, overlay typography, camera)
 * is derived from a single scalar `time`, so scrubbing is exact and
 * the four scenes cross-fade on the same curve.
 */

import { clamp01, smoothstep } from './math';

export const DURATION = 15;

export type SceneId = 'zero' | 'endless' | 'again' | 'zea';

export interface SceneMeta {
  id: SceneId;
  code: '01' | '02' | '03' | '04';
  name: string;
  start: number;
  end: number;
  /** short chinese reading of the brand line */
  cn: string;
}

export const SCENES: readonly SceneMeta[] = [
  { id: 'zero', code: '01', name: 'ZERO.', start: 0, end: 3, cn: '零为始' },
  { id: 'endless', code: '02', name: 'ENDLESS.', start: 3, end: 7, cn: '循无界' },
  { id: 'again', code: '03', name: 'AGAIN.', start: 7, end: 11, cn: '塑新生' },
  { id: 'zea', code: '04', name: 'ZEA', start: 11, end: 15, cn: '清蓝' },
];

export const sceneIndexAt = (time: number): number => {
  const t = clamp01(time / DURATION) * DURATION;
  for (let i = SCENES.length - 1; i >= 0; i--) {
    if (t >= SCENES[i].start) return i;
  }
  return 0;
};

/** 0 → 1 progress inside the current scene */
export function sceneLocalProgress(time: number): number {
  const i = sceneIndexAt(time);
  const scene = SCENES[i];
  return clamp01((time - scene.start) / (scene.end - scene.start));
}

export interface MorphWeights {
  /** complex fibre bundle → möbius loop */
  toMobius: number;
  /** möbius loop → resin chip cluster */
  toChips: number;
  /** chip cluster → ZEA wordmark */
  toWordmark: number;
}

/**
 * Progressive morph weights. They deliberately straddle the scene cuts
 * (a transition starting half a second before the cut reads as one
 * continuous material transformation instead of four stacked shots).
 */
export function morphAt(time: number): MorphWeights {
  return {
    toMobius: smoothstep(2.45, 3.95, time),
    toChips: smoothstep(6.55, 8.15, time),
    toWordmark: smoothstep(10.35, 11.95, time),
  };
}

export interface LayerState {
  /** 0 = hidden */
  fibers: number;
  mobius: number;
  chips: number;
  /** particle emission / global particle opacity */
  particles: number;
  /** crisp typographic lockup */
  lockup: number;
}

export function layersAt(time: number): LayerState {
  const fibers =
    time <= 3.4 ? 1 - smoothstep(2.72, 3.2, time) : 0;
  const mobius =
    smoothstep(2.8, 3.9, time) * (1 - smoothstep(6.95, 7.7, time));
  const chips =
    smoothstep(7.45, 8.5, time) * (1 - smoothstep(10.45, 11.25, time));
  const particles = smoothstep(1.3, 2.6, time);
  const lockup = smoothstep(12.35, 13.15, time);

  return { fibers, mobius, chips, particles, lockup };
}

export interface FiberState {
  /** strands pull apart, the composite interface opens up */
  separation: number;
  /** noise dissolve threshold 0 → 1 */
  dissolve: number;
  alpha: number;
}

export function fibersAt(time: number): FiberState {
  return {
    separation: smoothstep(1.25, 2.9, time),
    dissolve: smoothstep(1.85, 3.05, time),
    alpha: 1 - smoothstep(2.85, 3.25, time),
  };
}

export interface OverlayState {
  /** which scene label is on screen, -1 = none */
  active: number;
  /** opacity of that label */
  alpha: number;
  /** 0 → 1 entrance of the label inside its own scene */
  progress: number;
}

export function overlayAt(time: number): OverlayState {
  const index = sceneIndexAt(time);
  if (index === 3) return { active: -1, alpha: 0, progress: 0 };

  const scene = SCENES[index];
  const local = time - scene.start;
  const span = scene.end - scene.start;
  const p = clamp01(local / span);

  const inAlpha = smoothstep(0.12, 0.72, local);
  const outAlpha = 1 - smoothstep(span - 0.85, span - 0.18, local);

  return { active: index, alpha: inAlpha * outAlpha, progress: p };
}
