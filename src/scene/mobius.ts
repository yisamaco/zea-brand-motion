import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  ShaderMaterial,
  Texture,
  Vector3,
} from 'three';
import { clamp01, easeOutCubic, mulberry32 } from '../core/math';

export const MOBIUS_RADIUS = 2.55;
export const MOBIUS_WIDTH = 0.82;

/**
 * Endless loop surface, standing in the XY plane.
 *
 * A true half-twist band is single sided: closing it always means stitching the
 * last ring onto the first one with v reversed, and that stitch reads as a
 * crease where the ribbon turns over. A full turn of twist keeps the loop just
 * as endless — the ribbon rolls over itself once per lap — while ring 2π lands
 * exactly on ring 0, so the mesh closes seamlessly and normals stay continuous.
 */
export function mobiusPoint(
  u: number,
  v: number,
  radius = MOBIUS_RADIUS,
  width = MOBIUS_WIDTH,
  out = new Vector3(),
): Vector3 {
  const c = radius + v * Math.cos(u * 0.5);
  out.set(c * Math.cos(u), c * Math.sin(u), v * Math.sin(u * 0.5));
  return out;
}

export function createMobiusGeometry(
  radius = MOBIUS_RADIUS,
  width = MOBIUS_WIDTH,
  uSeg = 360,
  vSeg = 20,
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ring0Normals: number[] = [];

  for (let i = 0; i < uSeg; i++) {
    const u = (i / uSeg) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const ch = Math.cos(u * 0.5);
    const sh = Math.sin(u * 0.5);

    for (let j = 0; j <= vSeg; j++) {
      const v = -width + 2 * width * (j / vSeg);
      const c = radius + v * ch;

      positions.push(c * cu, c * su, v * sh);

      // analytic normal = ∂P/∂u × ∂P/∂v
      const dxu = -v * 0.5 * sh * cu - c * su;
      const dyu = -v * 0.5 * sh * su + c * cu;
      const dzu = v * 0.5 * ch;

      const dxv = ch * cu;
      const dyv = ch * su;
      const dzv = sh;

      let nx = dyu * dzv - dzu * dyv;
      let ny = dzu * dxv - dxu * dzv;
      let nz = dxu * dyv - dyu * dxv;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      if (i === 0) ring0Normals.push(nx, ny, nz);

      normals.push(nx, ny, nz);
      uvs.push(i / uSeg, j / vSeg);
    }
  }

  const idx = (i: number, j: number) => i * (vSeg + 1) + j;

  // close the single sided band: the last ring stitches onto ring 0 with v
  // reversed, which is exactly what a half twist does
  for (let i = 0; i < uSeg; i++) {
    const wrap = i === uSeg - 1;
    for (let j = 0; j < vSeg; j++) {
      const a = idx(i, j);
      const b = idx(i, j + 1);
      const c = wrap ? idx(0, vSeg - j) : idx(i + 1, j);
      const d = wrap ? idx(0, vSeg - j - 1) : idx(i + 1, j + 1);
      if (wrap) {
        indices.push(a, d, b);
        indices.push(a, c, d);
      } else {
        indices.push(a, b, d);
        indices.push(a, d, c);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

const FLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLOW_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;

  void main() {
    float head = fract(vUv.x * 0.82 - uTime * 0.13);
    float pulse = smoothstep(0.0, 0.34, head) * (1.0 - smoothstep(0.34, 0.78, head));

    float edge = smoothstep(0.40, 0.5, abs(vUv.y - 0.5));
    float glow = pulse * (0.5 + 0.5 * edge);
    vec3 tint = mix(vec3(0.40, 0.63, 0.94), vec3(0.88, 0.96, 1.0), pulse);

    gl_FragColor = vec4(tint, glow * uAlpha);
  }
`;

export interface MobiusState {
  alpha: number;
  appear: number;
  deconstruct: number;
}

export interface MobiusSystem {
  group: Group;
  update(state: MobiusState, time: number): void;
  sampleSurface(rng: () => number, count: number): Float32Array;
  dispose(): void;
}

export function createMobius(env: Texture | null): MobiusSystem {
  const group = new Group();

  const geometry = createMobiusGeometry();

  const bandMaterial = new MeshPhysicalMaterial({
    color: 0xb6c9d8,
    metalness: 1,
    roughness: 0.1,
    envMap: env,
    envMapIntensity: 1.85,
    iridescence: 0.3,
    iridescenceIOR: 1.25,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 1,
    side: DoubleSide, // the endless band is seen from both faces
  });
  const band = new Mesh(geometry, bandMaterial);
  group.add(band);

  // a light packet runs along the band inside the same material — drawing a
  // second surface for it would z-fight with the band and leave a bright slash
  const flowUniforms: { uFlowTime?: { value: number } } = {};
  bandMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uFlowTime = { value: 0 };
    flowUniforms.uFlowTime = shader.uniforms.uFlowTime;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFlowUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlowUv = uv;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vFlowUv;\nuniform float uFlowTime;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        {
          float head = fract(vFlowUv.x * 0.82 - uFlowTime * 0.13);
          float pulse = smoothstep(0.0, 0.34, head) * (1.0 - smoothstep(0.34, 0.78, head));
          float edge = smoothstep(0.40, 0.5, abs(vFlowUv.y - 0.5));
          vec3 tint = mix(vec3(0.34, 0.56, 0.86), vec3(0.82, 0.93, 1.0), pulse);
          totalEmissiveRadiance += tint * pulse * (0.35 + 0.65 * edge);
        }
        `,
      );
  };

  // points that hug the surface while it is assembling
  const sampleSurface = (rng: () => number, count: number): Float32Array => {
    const positions = new Float32Array(count * 3);
    const tmp = new Vector3();

    for (let i = 0; i < count; i++) {
      const u = rng() * Math.PI * 2;
      const v = (rng() * 2 - 1) * MOBIUS_WIDTH;
      mobiusPoint(u, v, MOBIUS_RADIUS, MOBIUS_WIDTH, tmp);

      const jitter = 0.055;
      positions[i * 3] = tmp.x + (rng() - 0.5) * jitter * 4;
      positions[i * 3 + 1] = tmp.y + (rng() - 0.5) * jitter * 4;
      positions[i * 3 + 2] = tmp.z + (rng() - 0.5) * jitter * 6;
    }

    return positions;
  };

  const update = (state: MobiusState, time: number) => {
    const { alpha, appear, deconstruct } = state;
    if (alpha <= 0.002) {
      group.visible = false;
      return;
    }
    group.visible = true;

    group.scale.setScalar(
      (0.94 + 0.06 * easeOutCubic(appear)) * (1 + 0.05 * easeOutCubic(deconstruct)),
    );
    group.rotation.y = 0.34 + time * 0.085;
    group.rotation.x = 0.2 + 0.05 * Math.sin(time * 0.55);
    group.rotation.z = 0.08 * Math.sin(time * 0.42 + 0.6);

    bandMaterial.opacity = clamp01(alpha * (1 - deconstruct * 0.25));
    bandMaterial.transparent = bandMaterial.opacity < 0.985;
    bandMaterial.envMapIntensity = 1.85 - deconstruct * 0.5;
    if (flowUniforms.uFlowTime) flowUniforms.uFlowTime.value = time;
  };

  const dispose = () => {
    geometry.dispose();
    bandMaterial.dispose();
  };

  return { group, update, sampleSurface, dispose };
}
