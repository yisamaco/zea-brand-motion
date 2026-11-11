import {
  BackSide,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  WebGLRenderer,
} from 'three';

/**
 * A tiny procedural photo studio, baked into a PMREM cube map.
 *
 * The möbius band and the resin chips are metal / glass: without a
 * believable environment they read as flat grey plastic. Long soft boxes
 * and one glacier-blue strip give the cold industrial highlights.
 */
export function createStudioEnvironment(renderer: WebGLRenderer): Texture {
  const envScene = new Scene();

  const dome = new Mesh(
    new SphereGeometry(90, 32, 24),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          float t = clamp(h * 0.5 + 0.5, 0.0, 1.0);
          vec3 deep = vec3(0.012, 0.015, 0.019);
          vec3 mid  = vec3(0.085, 0.098, 0.112);
          vec3 top  = vec3(0.020, 0.024, 0.030);
          vec3 c = t > 0.52
            ? mix(mid, top, (t - 0.52) / 0.48)
            : mix(deep, mid, t / 0.52);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    }),
  );
  envScene.add(dome);

  const panel = (
    hex: number,
    intensity: number,
    size: [number, number],
    position: [number, number, number],
  ) => {
    const mesh = new Mesh(
      new PlaneGeometry(size[0], size[1]),
      new MeshBasicMaterial({
        color: new Color(hex).multiplyScalar(intensity),
        toneMapped: false,
      }),
    );
    mesh.position.set(position[0], position[1], position[2]);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
    return mesh;
  };

  // big top soft box → long specular streak on the metal band
  panel(0xffffff, 3.2, [46, 20], [0, 26, 6]);
  // vertical glacier strip → the blue "clean blue" reflection
  panel(0x7fa8c8, 2.6, [7, 40], [-26, 2, 8]);
  // narrow cold rim from behind
  panel(0xdff0ff, 2.0, [4, 34], [20, 4, -18]);
  // small hard highlight top-right for the glassy glint
  panel(0xffffff, 4.0, [6, 3], [14, 16, -14]);
  // extra strips at different azimuths — metal needs several light shapes
  panel(0x9fc6e0, 2.2, [34, 3], [-10, 10, 22]);
  panel(0xffffff, 1.8, [2, 30], [24, -8, 14]);
  // faint floor bounce
  panel(0x223244, 1.1, [60, 30], [0, -30, 0]);

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromScene(envScene, 0.035, 0.1, 300);

  envScene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
  });
  pmrem.dispose();

  return target.texture;
}

/**
 * The void behind everything: a graphite gradient with a soft glacier halo.
 * Kept as a shader plane so the background shifts with the scene instead of
 * being a flat CSS fill.
 */
export function createBackdrop(): {
  mesh: Mesh;
  setGlow: (strength: number, glowY: number) => void;
} {
  const uniforms = {
    uTop: { value: new Color(0x14181c) },
    uBottom: { value: new Color(0x06070a) },
    uGlow: { value: new Color(0x315a7e) },
    uGlowStrength: { value: 0.35 },
    uGlowY: { value: 0.5 },
    uTime: { value: 0 },
  };

  const material = new ShaderMaterial({
    uniforms,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uGlow;
      uniform float uGlowStrength;
      uniform float uGlowY;
      uniform float uTime;

      void main() {
        vec3 base = mix(uBottom, uTop, pow(vUv.y, 0.85));

        vec2 centered = (vUv - vec2(0.5, uGlowY)) * vec2(1.35, 1.0);
        float d = length(centered);
        float halo = exp(-d * 2.6) * uGlowStrength;

        // very wide, very faint vertical banding — keeps the void from banding
        float bands = 0.0035 * sin(vUv.y * 190.0 + uTime * 0.02);

        vec3 c = base + uGlow * halo * 0.9 + vec3(bands);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });

  const mesh = new Mesh(new PlaneGeometry(140, 90), material);
  mesh.position.set(0, 0, -30);
  mesh.renderOrder = -10;

  return {
    mesh,
    setGlow(strength: number, glowY: number) {
      uniforms.uGlowStrength.value = strength;
      uniforms.uGlowY.value = glowY;
      uniforms.uTime.value += 0.016;
    },
  };
}
