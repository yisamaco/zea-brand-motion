import {
  CatmullRomCurve3,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from 'three';

const NOISE_GLSL = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }
`;

const FIBER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 p = position;
    // micro breathing so the bundle still feels alive before it opens up
    p += normal * sin(p.y * 2.6 + uTime * 1.05 + uSeed * 6.283) * 0.013;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FIBER_FRAG = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform vec3 uSpec;
  uniform float uTime;
  uniform float uSeed;
  uniform float uDissolve;
  uniform float uAlpha;
  uniform float uRibbon;

  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;

  ${NOISE_GLSL}

  void main() {
    float thr = uDissolve * 0.9;
    // fine noise along the filament: the bundle tears into fibres, not slabs
    float n = vnoise(vec3(vUv * vec2(56.0, 4.0), uSeed));
    if (n < thr) discard;

    float burn = uDissolve > 0.001
      ? smoothstep(thr, thr + 0.16, n) * (1.0 - smoothstep(thr + 0.16, thr + 0.34, n))
      : 0.0;

    float fres = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.6);

    // filament twist ribs + a slow sheen travelling along the strand
    float rib = pow(0.5 + 0.5 * sin(vUv.x * 240.0 * uRibbon + vUv.y * 6.2831 * 2.0), 6.0);
    float sheen = pow(0.5 + 0.5 * cos(vUv.x * 58.0 - uTime * 0.85 + uSeed * 3.14), 12.0);

    vec3 col = uBase;
    col += uRim * fres * 0.8;
    col += uSpec * (rib * 0.14 + sheen * 0.2);
    col += vec3(0.50, 0.66, 0.82) * burn * 0.75;

    gl_FragColor = vec4(col, uAlpha);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

export interface FiberState {
  separation: number;
  dissolve: number;
  alpha: number;
}

export interface FiberSystem {
  group: Group;
  update(state: FiberState, time: number): void;
  /** points along the real fibre curves — the source of the released particles */
  sampleEmission(rng: () => number, count: number): Float32Array;
  dispose(): void;
}

interface StrandRecord {
  mesh: Mesh;
  material: ShaderMaterial;
  dir: Vector3;
  spread: number;
  unwind: number;
  dissolveBias: number;
}

/**
 * Scene 1 — a blended yarn: three bundles, each a set of filaments winding
 * around the bundle's centre line, so the silhouette reads as textile
 * (twisted plied yarn) and not as random wire.
 */
export function createFibers(rng: () => number, strandCount: number): FiberSystem {
  const group = new Group();
  const curves: CatmullRomCurve3[] = [];
  const strands: StrandRecord[] = [];
  const disposables: Array<{ dispose(): void }> = [];

  const BUNDLES = 3;
  const perBundle = Math.ceil(strandCount / BUNDLES);

  for (let i = 0; i < strandCount; i++) {
    const bundle = i % BUNDLES;
    const filament = Math.floor(i / BUNDLES);

    const bundlePhase = bundle * 1.9 + 0.4;
    const bundleRadius = 0.95 + bundle * 0.55;
    const bundleTurns = 2.2 + bundle * 0.3;
    const height = 4.4 + bundle * 0.5;

    // each filament winds around the bundle's centre line
    const filPhase =
      (filament / Math.max(perBundle, 1)) * Math.PI * 2 * 2.0 + (rng() - 0.5) * 0.3;
    const filOffset = 0.07 + rng() * 0.22;

    const pts: Vector3[] = [];
    for (let k = 0; k <= 9; k++) {
      const t = k / 9;
      const ang = bundlePhase + t * Math.PI * 2 * bundleTurns;
      const r = bundleRadius + Math.sin(t * Math.PI) * 0.32;
      const cx = Math.cos(ang) * r;
      const cz = Math.sin(ang) * r * 0.8;
      const nx = Math.cos(ang + Math.PI / 2);
      const nz = Math.sin(ang + Math.PI / 2);

      const a = filPhase + t * Math.PI * 2 * 2.4;
      const off = filOffset * Math.cos(a);
      pts.push(
        new Vector3(
          cx + nx * off,
          (t - 0.5) * height + filOffset * Math.sin(a) * 1.1,
          cz + nz * off * 0.9,
        ),
      );
    }

    const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    curves.push(curve);

    const tubeRadius = 0.013 + Math.pow(rng(), 1.8) * 0.055;
    const geometry = new TubeGeometry(curve, 128, tubeRadius, 8, false);
    disposables.push(geometry);

    const material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: rng() * 10 },
        uDissolve: { value: 0 },
        uAlpha: { value: 1 },
        uRibbon: { value: 0.6 + rng() * 1.4 },
        uBase: { value: new Vector3(0.038, 0.044, 0.052) },
        uRim: { value: new Vector3(0.58, 0.71, 0.85) },
        uSpec: { value: new Vector3(0.92, 0.97, 1.0) },
      },
      vertexShader: FIBER_VERT,
      fragmentShader: FIBER_FRAG,
      transparent: true,
      depthWrite: true,
      side: DoubleSide,
    });
    disposables.push(material);

    const mesh = new Mesh(geometry, material);
    group.add(mesh);

    const center = curve.getPoint(0.5);
    const dir = new Vector3(center.x, 0, center.z);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();

    strands.push({
      mesh,
      material,
      dir,
      spread: 0.22 + rng() * 0.5,
      unwind: (rng() - 0.5) * 1.2,
      dissolveBias: 0.8 + rng() * 0.2,
    });
  }

  return {
    group,
    update(state: FiberState, time: number) {
      group.rotation.y = time * 0.16;
      group.rotation.x = Math.sin(time * 0.22) * 0.05;

      for (let i = 0; i < strands.length; i++) {
        const s = strands[i];
        const sep = state.separation;
        s.mesh.position.set(
          s.dir.x * sep * s.spread,
          Math.sin(sep * 3.1 + i) * sep * 0.14,
          s.dir.z * sep * s.spread,
        );
        s.mesh.rotation.y = sep * s.unwind;
        s.mesh.rotation.z = sep * s.unwind * 0.4;

        const u = s.material.uniforms;
        u.uTime.value = time;
        u.uDissolve.value = state.dissolve * s.dissolveBias;
        u.uAlpha.value = state.alpha;
      }
    },
    sampleEmission(rng, count) {
      const out = new Float32Array(count * 3);
      const tmp = new Vector3();
      for (let i = 0; i < count; i++) {
        const curve = curves[Math.floor(rng() * curves.length)];
        const u = rng();
        curve.getPointAt(u, tmp);
        const jitter = 0.05 + rng() * 0.3;
        const theta = rng() * Math.PI * 2;
        out[i * 3] = tmp.x + Math.cos(theta) * jitter;
        out[i * 3 + 1] = tmp.y + (rng() - 0.5) * jitter * 1.4;
        out[i * 3 + 2] = tmp.z + Math.sin(theta) * jitter;
      }
      return out;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
