import { describe, expect, it } from 'vitest';
import { clamp01, formatTime, keyframe, smoothstep } from '../src/core/math';
import {
  DURATION,
  fibersAt,
  layersAt,
  morphAt,
  overlayAt,
  sceneIndexAt,
  sceneLocalProgress,
  SCENES,
} from '../src/core/timeline';
import { FrameGovernor, particleBudget } from '../src/core/quality';

describe('timeline', () => {
  it('is a 15 second score with four scenes that tile the whole duration', () => {
    expect(DURATION).toBe(15);
    expect(SCENES).toHaveLength(4);
    expect(SCENES[0].start).toBe(0);
    expect(SCENES[3].end).toBe(DURATION);

    for (let i = 1; i < SCENES.length; i++) {
      expect(SCENES[i].start).toBeCloseTo(SCENES[i - 1].end, 5);
    }
  });

  it('maps time to the right scene at the exact cut points', () => {
    expect(sceneIndexAt(0)).toBe(0);
    expect(sceneIndexAt(2.999)).toBe(0);
    expect(sceneIndexAt(3)).toBe(1);
    expect(sceneIndexAt(6.999)).toBe(1);
    expect(sceneIndexAt(7)).toBe(2);
    expect(sceneIndexAt(10.999)).toBe(2);
    expect(sceneIndexAt(11)).toBe(3);
    expect(sceneIndexAt(15)).toBe(3);
    expect(sceneIndexAt(99)).toBe(3);
  });

  it('reports local progress inside a scene', () => {
    expect(sceneLocalProgress(0)).toBe(0);
    expect(sceneLocalProgress(3)).toBe(0);
    expect(sceneLocalProgress(5)).toBeCloseTo(0.5, 5);
    expect(sceneLocalProgress(6.9)).toBeGreaterThan(0.9);
  });

  it('runs the three morph weights in order and never backwards', () => {
    let previous = -1;
    for (let t = 0; t <= DURATION; t += 0.05) {
      const morph = morphAt(t);
      const sum = morph.toMobius + morph.toChips + morph.toWordmark;
      expect(sum).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = sum;
    }

    expect(morphAt(0).toMobius).toBe(0);
    expect(morphAt(3.5).toMobius).toBeGreaterThan(0.4);
    expect(morphAt(9).toChips).toBe(1);
    expect(morphAt(15).toWordmark).toBe(1);
    expect(morphAt(15).toChips).toBe(1);
  });

  it('fades each layer inside its own window', () => {
    expect(layersAt(0).fibers).toBe(1);
    expect(layersAt(0).particles).toBe(0);
    expect(layersAt(3.4).fibers).toBe(0);
    expect(layersAt(2.0).particles).toBeGreaterThan(0.2);

    expect(layersAt(4.6).mobius).toBeCloseTo(1, 3);
    expect(layersAt(0).mobius).toBe(0);
    expect(layersAt(7.8).mobius).toBe(0);

    expect(layersAt(7).chips).toBe(0);
    expect(layersAt(9.2).chips).toBeCloseTo(1, 3);
    expect(layersAt(11.4).chips).toBe(0);

    expect(layersAt(12).lockup).toBe(0);
    expect(layersAt(13.2).lockup).toBe(1);
    expect(layersAt(15).lockup).toBe(1);
  });

  it('opens the fibre bundle before it dissolves', () => {
    const at0 = fibersAt(0);
    expect(at0.separation).toBe(0);
    expect(at0.dissolve).toBe(0);
    expect(at0.alpha).toBe(1);

    const atMid = fibersAt(2.2);
    expect(atMid.separation).toBeGreaterThan(0.3);

    const atEnd = fibersAt(3.3);
    expect(atEnd.alpha).toBe(0);
    expect(atEnd.dissolve).toBe(1);
  });

  it('shows exactly one scene label and no label in the final lockup', () => {
    expect(overlayAt(0).alpha).toBe(0);
    expect(overlayAt(0.9).active).toBe(0);
    expect(overlayAt(0.9).alpha).toBeGreaterThan(0.9);
    expect(overlayAt(2.9).alpha).toBeLessThan(0.4);
    expect(overlayAt(5).active).toBe(1);
    expect(overlayAt(12).active).toBe(-1);
  });
});

describe('math', () => {
  it('keeps smoothstep inside 0..1 and hits its edges', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 5);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(2, 2, 2)).toBe(1);
    expect(clamp01(1.7)).toBe(1);
  });

  it('interpolates keyframes with soft, non-overshooting curves', () => {
    const keys: Array<[number, number]> = [
      [0, 0],
      [1, 2],
      [2, 0],
    ];
    expect(keyframe(keys, -1)).toBe(0);
    expect(keyframe(keys, 0)).toBe(0);
    expect(keyframe(keys, 2)).toBe(0);
    expect(keyframe(keys, 3)).toBe(0);

    const mid = keyframe(keys, 1);
    expect(mid).toBeGreaterThan(1.5);
    expect(mid).toBeLessThan(2.2);
  });

  it('formats timecodes for the transport', () => {
    expect(formatTime(0)).toBe('00.00');
    expect(formatTime(4.25)).toBe('04.25');
    expect(formatTime(14.99)).toBe('14.99');
  });
});

describe('performance governor', () => {
  it('drops the particle budget when frames are slow', () => {
    const scales: number[] = [];
    const governor = new FrameGovernor({ targetFps: 50, onScale: (s) => scales.push(s) });

    for (let i = 0; i < 200; i++) governor.frame(1 / 30); // 30fps
    expect(scales.length).toBeGreaterThan(0);
    expect(governor.scale).toBeLessThan(1);
    expect(governor.scale).toBeGreaterThanOrEqual(0.35);
  });

  it('does not degrade when frames are healthy', () => {
    let calls = 0;
    const governor = new FrameGovernor({ targetFps: 50, onScale: () => calls++ });
    for (let i = 0; i < 300; i++) governor.frame(1 / 60);
    expect(calls).toBe(0);
    expect(governor.scale).toBe(1);
  });

  it('never drops below a legible particle count', () => {
    expect(particleBudget(10000, 1)).toBe(10000);
    expect(particleBudget(10000, 0.1)).toBe(1500);
  });
});
