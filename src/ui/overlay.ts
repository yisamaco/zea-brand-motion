import { layersAt, overlayAt } from '../core/timeline';

/** typographic layer: scene words + the final lockup */
export class Overlay {
  private readonly labels: HTMLElement[];
  private readonly lockup: HTMLElement;
  private readonly app: HTMLElement;
  private lastAlpha = new Array(4).fill(-1);
  private lastLockup = -1;

  constructor(app: HTMLElement) {
    this.app = app;
    this.labels = Array.from(app.querySelectorAll<HTMLElement>('.scene-label'));
    const lockup = app.querySelector<HTMLElement>('#lockup');
    if (!lockup) throw new Error('lockup missing');
    this.lockup = lockup;

    for (const label of this.labels) {
      label.style.opacity = '0';
      label.style.transform = 'translate3d(0, 14px, 0)';
    }
  }

  update(time: number): void {
    const state = overlayAt(time);

    this.labels.forEach((label, index) => {
      const active = index === state.active ? state.alpha : 0;
      if (Math.abs(active - this.lastAlpha[index]) < 0.004) return;
      this.lastAlpha[index] = active;

      const lift = (1 - state.progress) * 18;
      label.style.opacity = active.toFixed(3);
      label.style.transform = `translate3d(0, ${lift.toFixed(1)}px, 0)`;
      label.style.filter = active < 0.98 ? `blur(${((1 - active) * 3).toFixed(2)}px)` : 'none';
    });

    const lockup = layersAt(time).lockup;
    if (Math.abs(lockup - this.lastLockup) > 0.002) {
      this.lastLockup = lockup;
      this.lockup.style.opacity = lockup.toFixed(3);
      this.lockup.style.transform = `translate(-50%, ${(1 - lockup) * 18 + 14}px)`;
      this.lockup.style.filter = lockup < 0.98 ? `blur(${((1 - lockup) * 2).toFixed(2)}px)` : 'none';
    }
  }

  /** hides the type layer entirely (used by clean / exhibition mode) */
  setClean(clean: boolean): void {
    this.app.classList.toggle('is-clean', clean);
  }
}
