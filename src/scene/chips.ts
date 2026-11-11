import {
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  InstancedMesh,
  MeshPhysicalMaterial,
  Object3D,
  Shape,
  Texture,
} from 'three';
import { clamp01 } from '../core/math';

/**
 * Irregular thin PET flake. Real flakes are not rounded tiles: they are flat,
 * uneven chips with soft-cut corners and a thin section that flashes a
 * highlight along the bevel.
 */
function flakeGeometry(radius = 0.2, depth = 0.016): ExtrudeGeometry {
  const shape = new Shape();
  const sides = 5;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + 0.25;
    const r = radius * (0.82 + 0.28 * Math.abs(Math.sin(i * 2.31 + 0.7)));
    pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.82]);
  }

  // round the vertices a little so the chip reads as cut film, not as gravel
  const round = 0.22;
  for (let i = 0; i < sides; i++) {
    const prev = pts[(i + sides - 1) % sides];
    const cur = pts[i];
    const next = pts[(i + 1) % sides];
    const inX = cur[0] + (prev[0] - cur[0]) * round;
    const inY = cur[1] + (prev[1] - cur[1]) * round;
    const outX = cur[0] + (next[0] - cur[0]) * round;
    const outY = cur[1] + (next[1] - cur[1]) * round;
    if (i === 0) shape.moveTo(inX, inY);
    else shape.lineTo(inX, inY);
    shape.quadraticCurveTo(cur[0], cur[1], outX, outY);
  }
  shape.closePath();

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 1,
    curveSegments: 3,
    steps: 1,
  });
  geometry.center();
  return geometry;
}

interface ChipSeed {
  base: [number, number, number];
  speed: number;
  sway: number;
  phase: number;
  scale: [number, number, number];
  rot: [number, number, number];
  spin: [number, number, number];
}

export interface ChipSystem {
  mesh: InstancedMesh;
  update(alpha: number, time: number, appear: number): void;
  /** points inside the resting flake cluster — particles condense onto them */
  sampleCluster(rng: () => number, count: number): Float32Array;
  dispose(): void;
}

/**
 * Scene 3 — recycled PET flakes. They condense out of the particle field,
 * then slowly fall and tumble, so the material reads as "value regained"
 * rather than as debris.
 */
export function createChips(envMap: Texture, count: number, rng: () => number): ChipSystem {
  const geometry = flakeGeometry();
  const material = new MeshPhysicalMaterial({
    color: 0xdbe9f4,
    metalness: 0.03,
    roughness: 0.045,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMap,
    envMapIntensity: 2.6,
    ior: 1.54,
    specularIntensity: 1,
    transparent: true,
    opacity: 0.7,
    depthWrite: true,
    side: DoubleSide, // flakes are seen from both faces while tumbling
  });

  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.visible = false;

  const seeds: ChipSeed[] = [];
  const dummy = new Object3D();

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    // dense core stream + a sparser outer cloud: reads as one falling material
    const radius = (rng() < 0.6 ? 0.9 : 1.7) * Math.pow(rng(), 0.6);
    const s = 0.3 + rng() * 0.5;
    seeds.push({
      base: [
        Math.cos(angle) * radius,
        -2.3 + rng() * 5.0,
        Math.sin(angle) * radius * 0.82,
      ],
      speed: 0.3 + rng() * 0.55,
      sway: 0.1 + rng() * 0.28,
      phase: rng() * Math.PI * 2,
      // non-uniform scale: some are broad flakes, some are thin slivers
      scale: [
        s * (0.7 + rng() * 0.75),
        s * (0.7 + rng() * 0.75),
        s * (0.55 + rng() * 0.45),
      ],
      rot: [rng() * Math.PI, rng() * Math.PI, rng() * Math.PI],
      spin: [
        (rng() - 0.5) * 0.5,
        (rng() - 0.5) * 0.55,
        (rng() - 0.5) * 0.4,
      ],
    });
  }

  const Y_MIN = -3.1;
  const Y_SPAN = 6.4;

  return {
    mesh,
    update(alpha: number, time: number, appear: number) {
      mesh.visible = alpha > 0.01;
      if (!mesh.visible) return;

      material.opacity = alpha * 0.7;

      // local time inside scene 3, with a little pre-roll so flakes are moving
      const local = time - 7 + 0.5;
      const grow = 0.75 + 0.25 * clamp01(appear);

      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        const fall = ((s.base[1] - local * s.speed - Y_MIN) % Y_SPAN + Y_SPAN) % Y_SPAN + Y_MIN;

        dummy.position.set(
          s.base[0] + Math.sin(local * 0.5 + s.phase) * s.sway,
          fall,
          s.base[2] + Math.cos(local * 0.42 + s.phase) * s.sway,
        );
        dummy.rotation.set(
          s.rot[0] + local * s.spin[0],
          s.rot[1] + local * s.spin[1],
          s.rot[2] + local * s.spin[2],
        );
        dummy.scale.set(
          s.scale[0] * grow,
          s.scale[1] * grow,
          s.scale[2] * grow,
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    sampleCluster(rng, count) {
      const out = new Float32Array(count * 3);
      const gauss = () => {
        const u = Math.max(1e-6, rng());
        const v = rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
      };
      for (let i = 0; i < count; i++) {
        // gaussian cloud: no hard rim, so the field never reads as a block
        const a = rng() * Math.PI * 2;
        const r = Math.abs(gauss()) * 0.72;
        out[i * 3] = Math.cos(a) * r;
        out[i * 3 + 1] = gauss() * 1.55;
        out[i * 3 + 2] = Math.sin(a) * r * 0.72;
      }
      return out;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
