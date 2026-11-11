import './style.css';
import { Clock } from 'three';
import { detectTier, settingsFor } from './core/quality';
import { DURATION, SCENES, sceneIndexAt } from './core/timeline';
import { Stage } from './scene/stage';
import { Hud } from './ui/hud';
import { Overlay } from './ui/overlay';

const app = document.getElementById('app');
const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const fallback = document.getElementById('fallback');

if (!app || !canvas) throw new Error('stage markup missing');

const params = new URLSearchParams(window.location.search);

let stage: Stage | null = null;
try {
  stage = new Stage(canvas, settingsFor(detectTier()));
} catch (error) {
  console.error('[ZEA] WebGL init failed', error);
  if (fallback) fallback.hidden = false;
}

if (stage && fallback) fallback.hidden = true;

/* ── playback state ───────────────────────────────────────────── */

let time = Math.min(Math.max(Number(params.get('t') ?? '0') || 0, 0), DURATION);
let playing = params.get('paused') !== '1';
let loop = params.get('loop') !== '0';
let dragging = false;

const clock = new Clock();

/* ── ui ───────────────────────────────────────────────────────── */

const overlay = stage ? new Overlay(app) : null;
if (overlay) overlay.setClean(params.get('clean') === '1');

function togglePlay(): void {
  if (!playing && time >= DURATION) time = 0;
  playing = !playing;
}

function seekTo(next: number): void {
  time = Math.min(Math.max(next, 0), DURATION);
  stage?.update(time);
}

function jumpTo(index: number): void {
  const scene = SCENES[index];
  if (!scene) return;
  seekTo(scene.start + 0.02);
  if (!playing && time >= DURATION) playing = true;
}

function toggleLoop(): void {
  loop = !loop;
}

function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: unknown }).webkitFullscreenElement);
}

function toggleFullscreen(): void {
  type FsDoc = Document & {
    webkitExitFullscreen?: () => Promise<void>;
    webkitFullscreenElement?: Element | null;
  };
  type FsElement = HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };

  const doc = document as FsDoc;
  const el = document.documentElement as FsElement;

  if (!isFullscreen()) {
    (el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el))?.().catch(() => {});
  } else {
    (doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc))?.().catch(() => {});
  }
}

const hud = stage
  ? new Hud(app, {
      onTogglePlay: togglePlay,
      onSeekStart: () => {
        dragging = true;
      },
      onSeek: (value) => {
        dragging = true;
        seekTo(value);
      },
      onSeekEnd: () => {
        dragging = false;
      },
      onJump: jumpTo,
      onToggleLoop: toggleLoop,
      onToggleFullscreen: toggleFullscreen,
    })
  : null;

document.addEventListener('fullscreenchange', () => hud?.setFullscreen(isFullscreen()));
document.addEventListener('webkitfullscreenchange', () => hud?.setFullscreen(isFullscreen()));

/* ── input ────────────────────────────────────────────────────── */

canvas.addEventListener('click', () => {
  togglePlay();
});

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key;

  if (key === ' ') {
    event.preventDefault();
    togglePlay();
  } else if (key === 'ArrowRight') {
    event.preventDefault();
    seekTo(time + (event.shiftKey ? 1 : 0.2));
  } else if (key === 'ArrowLeft') {
    event.preventDefault();
    seekTo(time - (event.shiftKey ? 1 : 0.2));
  } else if (key >= '1' && key <= '4') {
    jumpTo(Number(key) - 1);
  } else if (key === 'f' || key === 'F') {
    toggleFullscreen();
  } else if (key === 'l' || key === 'L') {
    toggleLoop();
  }
});

/* ── responsive ───────────────────────────────────────────────── */

let resizeRaf = 0;
const onResize = () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    stage?.resize();
    stage?.update(time);
  });
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

/* ── transport touch / drag outside the range input ───────────── */

window.addEventListener('pointerup', () => {
  dragging = false;
});

/* ── loop ────────────────────────────────────────────────────── */

let lastScene = -1;

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (!dragging && playing) {
    time += dt;
    if (time >= DURATION) {
      if (loop) {
        time = time % DURATION;
      } else {
        time = DURATION;
        playing = false;
      }
    }
  }

  if (stage) {
    stage.update(time);
    stage.render(dt);
  }

  overlay?.update(time);
  hud?.update(time, playing, loop);

  const scene = sceneIndexAt(time);
  if (scene !== lastScene) {
    lastScene = scene;
    document.documentElement.dataset.scene = String(scene);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

/* ── debug / capture hook ────────────────────────────────────── */

declare global {
  interface Window {
    __ZEA__?: {
      seek: (t: number) => void;
      play: () => void;
      pause: () => void;
      getTime: () => number;
      stage: Stage | null;
    };
  }
}

window.__ZEA__ = {
  seek: seekTo,
  play: () => {
    playing = true;
  },
  pause: () => {
    playing = false;
  },
  getTime: () => time,
  stage,
};

if (params.get('hud') === '0') {
  app.querySelector<HTMLElement>('#hud')?.style.setProperty('display', 'none');
  app.querySelector<HTMLElement>('#hint')?.style.setProperty('display', 'none');
}
