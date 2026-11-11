/**
 * Performance budget + runtime adaptation.
 *
 * The piece is GPU particle heavy, so a low tier is not just "fewer pixels":
 * particle count, fibre strands, chip instances and DPR all step down together.
 * At runtime a FrameGovernor watches the average frame rate and keeps
 * shrinking the particle budget until the piece holds ~50fps.
 */

export type Tier = 'high' | 'mid' | 'low';

export interface QualitySettings {
  tier: Tier;
  particles: number;
  strands: number;
  chips: number;
  pixelRatioCap: number;
  antialias: boolean;
}

export const QUALITY: Record<Tier, QualitySettings> = {
  high: { tier: 'high', particles: 52000, strands: 27, chips: 240, pixelRatioCap: 2, antialias: true },
  mid: { tier: 'mid', particles: 24000, strands: 21, chips: 170, pixelRatioCap: 1.75, antialias: true },
  low: { tier: 'low', particles: 11000, strands: 15, chips: 100, pixelRatioCap: 1.4, antialias: false },
};

export function settingsFor(tier: Tier): QualitySettings {
  return QUALITY[tier];
}

/** Cheap device tiering before a single frame is drawn. */
export function detectTier(): Tier {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const shortEdge =
    typeof window !== 'undefined' ? Math.min(window.innerWidth, window.innerHeight) : 900;

  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || shortEdge < 520;

  if (isMobile) {
    // large flagships can afford a mid budget, everything else goes low
    return cores >= 6 && dpr >= 2 ? 'mid' : 'low';
  }
  if (cores >= 8) return 'high';
  if (cores >= 4) return 'mid';
  return 'low';
}

export interface GovernorOptions {
  /** scale floor so the piece never turns into a slideshow */
  minScale?: number;
  /** sustain target */
  targetFps?: number;
  onScale?: (scale: number) => void;
}

/**
 * Monotonic downgrade governor: it only ever reduces the budget
 * (upgrading again mid-show causes visible popping).
 */
export class FrameGovernor {
  private scaleValue = 1;
  private windowTime = 0;
  private windowFrames = 0;
  private cooldown = 0;
  private readonly minScale: number;
  private readonly targetFps: number;
  private readonly onScale?: (scale: number) => void;

  constructor(options: GovernorOptions = {}) {
    this.minScale = options.minScale ?? 0.35;
    this.targetFps = options.targetFps ?? 50;
    this.onScale = options.onScale;
  }

  get scale(): number {
    return this.scaleValue;
  }

  reset(): void {
    this.scaleValue = 1;
    this.windowTime = 0;
    this.windowFrames = 0;
    this.cooldown = 0;
  }

  /** call once per rendered frame with the delta in seconds */
  frame(dt: number): void {
    if (dt <= 0) return;
    // a stall (tab switch, resize) should not drag the average down
    if (dt > 0.25) return;

    this.windowTime += dt;
    this.windowFrames += 1;
    if (this.cooldown > 0) this.cooldown -= dt;

    if (this.windowTime < 1.2) return;

    const fps = this.windowFrames / this.windowTime;
    this.windowTime = 0;
    this.windowFrames = 0;

    if (fps < this.targetFps - 6 && this.cooldown <= 0 && this.scaleValue > this.minScale) {
      this.scaleValue = Math.max(this.minScale, this.scaleValue * 0.78);
      this.cooldown = 1.6;
      this.onScale?.(this.scaleValue);
    }
  }
}

/** particle draw range for a budget scale (never below a legible amount) */
export function particleBudget(total: number, scale: number): number {
  return Math.max(1500, Math.floor(total * scale));
}
