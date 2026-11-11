import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

const FONT_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const TRACKING_EM = 0.1;
const TEXT = 'ZEA';

type Ctx = CanvasRenderingContext2D;

function setType(ctx: Ctx, fontSize: number): void {
  ctx.font = `400 ${fontSize}px ${FONT_STACK}`;
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${fontSize * TRACKING_EM}px`;
  } catch {
    /* letterSpacing is not universal — the default tracking still works */
  }
}

/** draws ZEA centred on (cx, cy) — shared by the samplers and the crisp mark */
function drawMark(
  ctx: Ctx,
  fontSize: number,
  cx: number,
  cy: number,
  withGlow: boolean,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setType(ctx, fontSize);

  if (withGlow) {
    ctx.shadowColor = 'rgba(146, 186, 218, 0.5)';
    ctx.shadowBlur = fontSize * 0.14;
  }
  ctx.fillText(TEXT, cx, cy);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/**
 * Samples the ZEA wordmark into particle targets.
 * The letters are rasterised once on an offscreen canvas, then opaque pixels
 * are randomly picked — cheap, exact, and typographically faithful.
 */
export function sampleWordmark(
  rng: () => number,
  count: number,
  targetWidth = 6.4,
): Float32Array {
  const out = new Float32Array(count * 3);
  if (typeof document === 'undefined') return out;

  const cw = 1024;
  const ch = 512;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return out;

  drawMark(ctx, 300, cw / 2, ch / 2, false);

  const image = ctx.getImageData(0, 0, cw, ch).data;
  const pixels: number[] = [];
  for (let y = 0; y < ch; y += 2) {
    for (let x = 0; x < cw; x += 2) {
      if (image[(y * cw + x) * 4 + 3] > 110) pixels.push(x, y);
    }
  }
  if (pixels.length === 0) return out;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pixels.length; i += 2) {
    minX = Math.min(minX, pixels[i]);
    maxX = Math.max(maxX, pixels[i]);
    minY = Math.min(minY, pixels[i + 1]);
    maxY = Math.max(maxY, pixels[i + 1]);
  }

  const spanX = Math.max(1, maxX - minX);
  const scale = targetWidth / spanX;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const n = pixels.length / 2;

  for (let i = 0; i < count; i++) {
    const k = Math.floor(rng() * n) * 2;
    const px = pixels[k] + (rng() - 0.5) * 2;
    const py = pixels[k + 1] + (rng() - 0.5) * 2;

    // a small halo of loose particles around the mark keeps it alive
    const loose = rng() < 0.035;
    const jitter = loose ? 0.34 : 0.025;

    out[i * 3] = (px - cx) * scale + (rng() - 0.5) * jitter;
    out[i * 3 + 1] = -(py - cy) * scale + (rng() - 0.5) * jitter;
    out[i * 3 + 2] = (rng() - 0.5) * (loose ? 0.55 : 0.1);
  }

  return out;
}

export interface WordmarkMark {
  mesh: Mesh;
  material: MeshBasicMaterial;
  /** world width of the letterforms themselves */
  width: number;
}

/**
 * A crisp, anti-aliased ZEA mark on a transparent plane.
 * It fades in as the particle field settles, so the final frame is a precise
 * brand mark instead of a cloud of dots — with the particles still glowing
 * behind it as material dust.
 */
export function createWordmarkMark(targetWidth = 6.4): WordmarkMark | null {
  if (typeof document === 'undefined') return null;

  const cw = 2048;
  const ch = 768;
  const fontSize = 440;

  const source = document.createElement('canvas');
  source.width = cw;
  source.height = ch;
  const ctx = source.getContext('2d');
  if (!ctx) return null;

  drawMark(ctx, fontSize, cw / 2, ch / 2, true);

  const image = ctx.getImageData(0, 0, cw, ch).data;
  let minX = cw;
  let maxX = 0;
  let minY = ch;
  let maxY = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (image[(y * cw + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return null;

  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  const pad = Math.round(bboxW * 0.05);
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.min(cw - cropX, bboxW + pad * 2);
  const cropH = Math.min(ch - cropY, bboxH + pad * 2);

  const cropped = document.createElement('canvas');
  cropped.width = cropW;
  cropped.height = cropH;
  const cropCtx = cropped.getContext('2d');
  if (!cropCtx) return null;
  cropCtx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  const texture = new CanvasTexture(cropped);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  const planeWidth = targetWidth * (cropW / bboxW);
  const planeHeight = planeWidth * (cropH / cropW);

  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    color: 0xeaf3fa,
  });

  const mesh = new Mesh(new PlaneGeometry(planeWidth, planeHeight), material);
  mesh.visible = false;

  return { mesh, material, width: planeWidth };
}
