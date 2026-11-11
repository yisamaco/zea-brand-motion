import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createMobiusGeometry, mobiusPoint, MOBIUS_RADIUS } from '../src/scene/mobius';

describe('möbius band', () => {
  it('samples the parametric surface', () => {
    const p = mobiusPoint(0, 0);
    expect(p.x).toBeCloseTo(MOBIUS_RADIUS, 5);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.z).toBeCloseTo(0, 5);
  });

  it('closes on itself with a reversed v — that is the half twist', () => {
    const a = mobiusPoint(Math.PI * 2, 0.4, MOBIUS_RADIUS, 0.95, new Vector3());
    const b = mobiusPoint(0, -0.4, MOBIUS_RADIUS, 0.95, new Vector3());
    expect(a.distanceTo(b)).toBeLessThan(1e-6);
  });

  it('builds a closed, non-degenerate mesh', () => {
    const uSeg = 48;
    const vSeg = 8;
    const geometry = createMobiusGeometry(MOBIUS_RADIUS, 0.95, uSeg, vSeg);

    const position = geometry.getAttribute('position');
    expect(position.count).toBe(uSeg * (vSeg + 1));

    const index = geometry.getIndex();
    expect(index).not.toBeNull();
    expect(index!.count).toBe(uSeg * vSeg * 6);

    const normal = geometry.getAttribute('normal');
    expect(normal).toBeDefined();

    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!;
    expect(sphere.radius).toBeGreaterThan(MOBIUS_RADIUS);
    expect(sphere.radius).toBeLessThan(MOBIUS_RADIUS + 1.5);

    let degenerate = 0;
    for (let i = 0; i < index!.count; i += 3) {
      const a = index!.getX(i);
      const b = index!.getX(i + 1);
      const c = index!.getX(i + 2);
      if (a === b || b === c || a === c) degenerate++;
    }
    expect(degenerate).toBe(0);

    geometry.dispose();
  });
});
