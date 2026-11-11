import { formatTime } from '../core/math';
import { DURATION, SCENES, sceneIndexAt } from '../core/timeline';

export interface HudHandlers {
  onTogglePlay(): void;
  onSeekStart(): void;
  onSeek(time: number): void;
  onSeekEnd(): void;
  onJump(index: number): void;
  onToggleLoop(): void;
  onToggleFullscreen(): void;
}

/** transport bar: play, scrub, scene jump, loop, fullscreen */
export class Hud {
  private readonly app: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly loopBtn: HTMLButtonElement;
  private readonly fullBtn: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly nowLabel: HTMLElement;
  private readonly navButtons: HTMLButtonElement[];
  private lastTimeText = '';
  private lastScene = -1;
  private idleTimer = 0;
  private idle = false;

  constructor(app: HTMLElement, handlers: HudHandlers) {
    this.app = app;

    const get = <T extends Element>(selector: string): T => {
      const el = app.querySelector<T>(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el;
    };

    this.playBtn = get<HTMLButtonElement>('#btn-play');
    this.loopBtn = get<HTMLButtonElement>('#btn-loop');
    this.fullBtn = get<HTMLButtonElement>('#btn-full');
    this.scrub = get<HTMLInputElement>('#scrub');
    this.nowLabel = get<HTMLElement>('#t-now');
    this.navButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('#scene-nav button'));

    this.playBtn.addEventListener('click', () => handlers.onTogglePlay());
    this.loopBtn.addEventListener('click', () => handlers.onToggleLoop());
    this.fullBtn.addEventListener('click', () => handlers.onToggleFullscreen());

    this.navButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.jump ?? '0');
        handlers.onJump(index);
      });
    });

    const start = () => {
      this.isDragging = true;
      handlers.onSeekStart();
    };
    const end = () => {
      this.isDragging = false;
      handlers.onSeekEnd();
    };

    this.scrub.addEventListener('pointerdown', start);
    this.scrub.addEventListener('input', () => handlers.onSeek(Number(this.scrub.value)));
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    this.buildTicks();
    this.bindIdle();
  }

  private buildTicks(): void {
    const host = this.app.querySelector<HTMLElement>('#ticks');
    if (!host) return;
    for (let s = 0; s <= DURATION; s++) {
      const tick = document.createElement('span');
      const major = SCENES.some((scene) => Math.abs(scene.start - s) < 1e-6);
      if (major) tick.classList.add('is-major');
      tick.style.left = `${(s / DURATION) * 100}%`;
      host.appendChild(tick);
    }
  }

  private bindIdle(): void {
    const wake = () => {
      if (this.idle) {
        this.idle = false;
        this.app.classList.remove('is-idle');
      }
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => {
        this.idle = true;
        this.app.classList.add('is-idle');
      }, 2800);
    };
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    wake();
  }

  update(time: number, playing: boolean, loop: boolean): void {
    this.playBtn.classList.toggle('is-playing', playing);
    this.playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');

    this.loopBtn.classList.toggle('is-on', loop);
    this.loopBtn.setAttribute('aria-pressed', String(loop));

    const text = formatTime(time);
    if (text !== this.lastTimeText) {
      this.lastTimeText = text;
      this.nowLabel.textContent = text;
    }

    if (!this.isDragging) this.scrub.value = String(time);
    this.scrub.style.setProperty('--p', String(time / DURATION));

    const scene = sceneIndexAt(time);
    if (scene !== this.lastScene) {
      this.lastScene = scene;
      this.navButtons.forEach((button, index) => {
        button.classList.toggle('is-active', index === scene);
      });
    }
  }

  private isDragging = false;

  setDragging(value: boolean): void {
    this.isDragging = value;
  }

  setFullscreen(active: boolean): void {
    this.fullBtn.classList.toggle('is-on', active);
    this.fullBtn.setAttribute('aria-label', active ? '退出全屏' : '全屏播放');
  }
}
