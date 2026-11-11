import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from 'three';
import { clamp, keyframe, mulberry32, smoothstep } from '../core/math';
import {
  FrameGovernor,
  particleBudget,
  type QualitySettings,
} from '../core/quality';
import { fibersAt, layersAt, morphAt } from '../core/timeline';
import { createBackdrop, createStudioEnvironment } from './environment';
import { createChips, type ChipSystem } from './chips';
import { createFibers, type FiberSystem } from './fibers';
import { createMobius, type MobiusSystem } from './mobius';
import { createParticles, type ParticleSystem } from './particles';
import { createWordmarkMark, sampleWordmark, type WordmarkMark } from './wordmark';

const BASE_LOGO_WIDTH = 6.4;

/* camera choreography — one continuous move through the four scenes */
const CAM_X: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [3, 0.1],
  [4.6, 3.8],
  [5.8, -0.4],
  [6.8, -4.6],
  [7.8, -2.4],
  [9, 0.8],
  [10.4, 1.4],
  [11.6, 0],
  [15, 0],
];
const CAM_Y: ReadonlyArray<readonly [number, number]> = [
  [0, 0.7],
  [3, 0.35],
  [4.6, 2.9],
  [5.8, 3.4],
  [6.8, 2.3],
  [7.8, 1.2],
  [9, 1.0],
  [10.4, 1.5],
  [11.6, 0.35],
  [15, 0.2],
];

const CAM_Z: ReadonlyArray<readonly [number, number]> = [
  [0, 12.8],
  [3, 9.4],
  [4.6, 11.4],
  [5.8, 11.2],
  [6.8, 11.4],
  [7.8, 11.2],
  [9, 11.6],
  [10.4, 11.2],
  [11.6, 8.7],
  [15, 8.6],
];

const TARGET_Y: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [9.5, 0.02],
  [10.8, 0.4],
  [12.4, 0.62],
  [15, 0.62],
];

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;

  private readonly settings: QualitySettings;
  private readonly env: Texture;
  private readonly backdrop: ReturnType<typeof createBackdrop>;
  private readonly fibers: FiberSystem;
  private readonly mobius: MobiusSystem;
  private readonly chips: ChipSystem;
  private readonly particles: ParticleSystem;
  private readonly dust: Points;
  private readonly mark: WordmarkMark | null;
  private readonly governor: FrameGovernor;
  private readonly particleTotal: number;

  private dprCap: number;

  constructor(canvas: HTMLCanvasElement, settings: QualitySettings) {
    this.settings = settings;
    this.dprCap = settings.pixelRatioCap;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: settings.antialias,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: true, // lets a still be captured without a re-render
    });
    this.renderer.setClearColor(0x07080a, 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;

    this.scene = new Scene();

    this.camera = new PerspectiveCamera(38, 1, 0.1, 220);
    this.camera.position.set(0, 0.72, 12.8);
    this.camera.lookAt(0, 0, 0);

    /* environment + background */
    const backdrop = createBackdrop();
    this.backdrop = backdrop;
    this.scene.add(backdrop.mesh);

    this.env = createStudioEnvironment(this.renderer);
    this.scene.environment = this.env;

    /* lights: cold key, glacier rim */
    const key = new DirectionalLight(0xdff0ff, 2.1);
    key.position.set(6, 9, 7);
    const rim = new DirectionalLight(0x4f7fa5, 1.6);
    rim.position.set(-7, -4, -5);
    const fill = new AmbientLight(0x263240, 0.75);
    this.scene.add(key, rim, fill);

    /* scene layers */
    this.fibers = createFibers(mulberry32(1117), settings.strands);
    this.scene.add(this.fibers.group);

    this.mobius = createMobius(this.env);
    this.scene.add(this.mobius.group);

    this.chips = createChips(this.env, settings.chips, mulberry32(5147));
    this.scene.add(this.chips.mesh);

    const count = settings.particles;
    this.particleTotal = count;

    const wordmark = sampleWordmark(mulberry32(90210), count, BASE_LOGO_WIDTH);
    const targets = {
      fibers: this.fibers.sampleEmission(mulberry32(3301), count),
      mobius: this.mobius.sampleSurface(mulberry32(4409), count),
      chips: this.chips.sampleCluster(mulberry32(8123), count),
      wordmark,
    };

    this.particles = createParticles(targets, count);
    this.scene.add(this.particles.points);

    // crisp mark that resolves on top of the particle field in the last beat
    this.mark = createWordmarkMark(BASE_LOGO_WIDTH);
    if (this.mark) {
      this.mark.mesh.position.set(0, 0.9, 0.5);
      this.scene.add(this.mark.mesh);
    }

    this.dust = this.createDust();
    this.scene.add(this.dust);

    this.governor = new FrameGovernor({
      minScale: 0.35,
      targetFps: 50,
      onScale: (scale) => this.applyBudget(scale),
    });

    this.resize();
    this.updateCamera(0);
    this.update(0);
  }

  private createDust(): Points {
    const count = this.settings.tier === 'low' ? 320 : 780;
    const rng = mulberry32(2718);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rng() - 0.5) * 26;
      positions[i * 3 + 1] = (rng() - 0.5) * 16;
      positions[i * 3 + 2] = (rng() - 0.5) * 20 - 4;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

    const material = new PointsMaterial({
      color: new Color(0x6e8ea8),
      size: 0.05,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    return new Points(geometry, material);
  }

  private updateCamera(time: number): void {
    this.camera.position.set(
      keyframe(CAM_X, time),
      keyframe(CAM_Y, time),
      keyframe(CAM_Z, time),
    );
    this.camera.lookAt(0, keyframe(TARGET_Y, time), 0);
  }

  /** apply the full timeline state for `time` (seconds) */
  update(time: number): void {
    const layers = layersAt(time);

    this.fibers.update(fibersAt(time), time);

    this.mobius.update(
      {
        alpha: layers.mobius,
        appear: smoothstep(2.8, 3.9, time),
        deconstruct: smoothstep(6.6, 7.7, time),
      },
      time,
    );

    this.chips.update(layers.chips, time, smoothstep(7.45, 8.5, time));

    const markAlpha = smoothstep(12.85, 13.65, time);
    if (this.mark) {
      this.mark.material.opacity = markAlpha * 0.94;
      this.mark.mesh.visible = markAlpha > 0.01;
    }

    // particles stay as the material dust around the resolved mark
    this.particles.setState(
      morphAt(time),
      layers.particles * (1 - 0.42 * markAlpha) * (1 - 0.12 * layers.mobius),
      time,
    );

    this.backdrop.setGlow(
      0.26 + layers.mobius * 0.38 + layers.chips * 0.16 + layers.lockup * 0.3,
      0.5,
    );

    this.dust.rotation.y = time * 0.018;
    this.dust.rotation.x = Math.sin(time * 0.1) * 0.06;

    this.updateCamera(time);
  }

  render(dt: number): void {
    this.renderer.render(this.scene, this.camera);
    if (dt > 0) this.governor.frame(dt);
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const aspect = width / Math.max(height, 1);

    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);

    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.7 ? 58 : aspect < 1.15 ? 48 : 38;
    this.camera.updateProjectionMatrix();

    // keep the ZEA mark inside the frame on portrait / phone screens
    const distance = 8.75;
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const visibleWidth = 2 * Math.tan(fovRad / 2) * distance * aspect;
    // on portrait the frame is narrow — keep a real margin around the mark
    const logoWidth = clamp(visibleWidth * 0.62, 1.4, BASE_LOGO_WIDTH);
    const logoScale = logoWidth / BASE_LOGO_WIDTH;
    this.particles.setLogoScale(logoScale);
    this.particles.setDpr(dpr);
    if (this.mark) this.mark.mesh.scale.setScalar(logoScale);
  }

  private applyBudget(scale: number): void {
    this.particles.setBudget(particleBudget(this.particleTotal, scale));
    if (scale <= 0.6) {
      this.dprCap = Math.min(this.dprCap, 1.35);
      const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
      this.renderer.setPixelRatio(dpr);
      this.particles.setDpr(dpr);
    }
  }

  get qualityScale(): number {
    return this.governor.scale;
  }

  dispose(): void {
    this.fibers.dispose();
    this.mobius.dispose();
    this.chips.dispose();
    this.particles.dispose();
    if (this.mark) {
      this.mark.mesh.geometry.dispose();
      this.mark.material.map?.dispose();
      this.mark.material.dispose();
    }
    this.env.dispose();
    this.renderer.dispose();
  }
}
