import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
} from 'three';
import { mulberry32 } from '../core/math';
import type { MorphWeights } from '../core/timeline';

const PARTICLE_VERT = /* glsl */ `
  uniform float uA;
  uniform float uB;
  uniform float uC;
  uniform float uTime;
  uniform float uSize;
  uniform float uDpr;
  uniform float uLogoScale;
  uniform float uLogoY;

  attribute vec3 aP0;
  attribute vec3 aP1;
  attribute vec3 aP2;
  attribute vec3 aP3;
  attribute float aSeed;
  attribute float aScale;
  attribute float aTone;

  varying float vTone;
  varying float vTwinkle;
  varying float vDepth;

  void main() {
    vec3 p = mix(aP0, aP1, uA);
    p = mix(p, aP2, uB);

    vec3 mark = aP3 * uLogoScale;
    p = mix(p, mark, uC);

    // the wordmark sits a little above centre so the lockup has room below
    p.y += uLogoY * uC;

    // organic drift — strongest while the field is free, calm once it locks
    float t = uTime;
    vec3 drift = vec3(
      sin(t * 0.80 + aSeed * 13.0),
      cos(t * 0.62 + aSeed * 7.7),
      sin(t * 0.50 + aSeed * 5.3)
    );
    float amount = (0.05 + 0.10 * (1.0 - uC)) * (0.35 + aScale);
    p += drift * amount;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = max(-mv.z, 0.001);

    gl_PointSize = clamp(
      uSize * aScale * uDpr * (9.0 / dist) * (1.0 - 0.26 * uC),
      1.0,
      26.0 * uDpr
    );

    vTone = aTone;
    vTwinkle = 0.70 + 0.30 * sin(t * 2.1 + aSeed * 23.0);
    vDepth = clamp(1.0 - dist / 30.0, 0.32, 1.0);

    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform vec3 uCold;
  uniform vec3 uGlacier;
  uniform float uOpacity;

  varying float vTone;
  varying float vTwinkle;
  varying float vDepth;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;

    float core = smoothstep(0.5, 0.02, d);
    float a = core * core;

    vec3 col = mix(uGlacier, uCold, vTone);
    col += vec3(0.20) * pow(core, 6.0);

    gl_FragColor = vec4(col, a * uOpacity * vTwinkle * vDepth);
  }
`;

export interface ParticleTargets {
  fibers: Float32Array;
  mobius: Float32Array;
  chips: Float32Array;
  wordmark: Float32Array;
}

export interface ParticleSystem {
  points: Points;
  setState(morph: MorphWeights, opacity: number, time: number): void;
  setBudget(count: number): void;
  setLogoScale(scale: number): void;
  setDpr(dpr: number): void;
  dispose(): void;
}

/**
 * One single particle buffer carries every state of the film:
 * fibre dust → möbius surface → resin flakes → the ZEA mark.
 * All four target sets live on the same index, so a morph is a pure
 * interpolant and nothing ever pops in or out.
 */
export function createParticles(targets: ParticleTargets, count: number): ParticleSystem {
  const rng = mulberry32(20261111);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(targets.fibers, 3));
  geometry.setAttribute('aP0', new Float32BufferAttribute(targets.fibers, 3));
  geometry.setAttribute('aP1', new Float32BufferAttribute(targets.mobius, 3));
  geometry.setAttribute('aP2', new Float32BufferAttribute(targets.chips, 3));
  geometry.setAttribute('aP3', new Float32BufferAttribute(targets.wordmark, 3));

  const seeds = new Float32Array(count);
  const scales = new Float32Array(count);
  const tones = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    seeds[i] = rng();
    // a few large "hero" sparks read as material glints
    scales[i] = 0.75 + Math.pow(rng(), 3) * 1.35;
    tones[i] = Math.pow(rng(), 0.7);
  }

  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
  geometry.setAttribute('aScale', new Float32BufferAttribute(scales, 1));
  geometry.setAttribute('aTone', new Float32BufferAttribute(tones, 1));
  geometry.setDrawRange(0, count);
  // particles travel far outside any static bounds — culling is disabled below
  const points = new Points(
    geometry,
    new ShaderMaterial({
      uniforms: {
        uA: { value: 0 },
        uB: { value: 0 },
        uC: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: 3.35 },
        uDpr: { value: 1 },
        uOpacity: { value: 0 },
        uLogoScale: { value: 1 },
        uLogoY: { value: 0.9 },
        uCold: { value: new Color(0xe6f2ff) },
        uGlacier: { value: new Color(0x74a8cf) },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = 3;

  const material = points.material as ShaderMaterial;

  return {
    points,
    setState(morph: MorphWeights, opacity: number, time: number) {
      const u = material.uniforms;
      u.uA.value = morph.toMobius;
      u.uB.value = morph.toChips;
      u.uC.value = morph.toWordmark;
      u.uOpacity.value = opacity;
      u.uTime.value = time;
    },
    setBudget(budget: number) {
      geometry.setDrawRange(0, Math.min(count, budget));
    },
    setLogoScale(scale: number) {
      material.uniforms.uLogoScale.value = scale;
    },
    setDpr(dpr: number) {
      material.uniforms.uDpr.value = dpr;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
