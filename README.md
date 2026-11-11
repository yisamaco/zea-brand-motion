# ZEA · 清蓝 — Brand Motion V1

**ZERO. ENDLESS. AGAIN.**
零为始 · 循无界 · 塑新生 — _A Future Without Waste._

A standalone 15-second Three.js brand film for ZEA · 清蓝, built for the website
hero and for international trade-show screens. Graphite black, cold white and
glacier blue; no leaf, no recycle arrow, no green — the sustainability story is
told through material behaviour, not eco clichés.

---

## 1. Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build → dist/
npm run preview    # serve the build → http://localhost:4173
npm test           # unit tests (timeline / geometry / governor)
```

Requires Node ≥ 18 and a WebGL2 browser.

### Deep links (useful for review and capture)

| Query            | Effect                                               |
| ---------------- | ---------------------------------------------------- |
| `?t=4.6`         | open on an exact frame (seconds, 0–15)                |
| `?paused=1`      | load paused                                          |
| `?loop=0`        | play once, hold on the final lockup                  |
| `?clean=1`       | motion only: all typography and the transport hidden |
| `?hud=0`         | hide the transport bar only                          |

Example: `http://localhost:4173/?t=6.2&paused=1&clean=1`

---

## 2. The 15-second score

| Time      | Scene       | What happens on screen                                                                     |
| --------- | ----------- | ------------------------------------------------------------------------------------------ |
| 0 – 3 s   | **ZERO.**   | Dozens of blended filaments (real tubes) and translucent matrix films twist in space; the composite interface opens, strands pull apart and dissolve into particles. |
| 3 – 7 s   | **ENDLESS.**| The particles condense onto a closed Möbius band — metal + glass, one continuous surface. The camera orbits it while a light vein travels along the band. |
| 7 – 11 s  | **AGAIN.**  | The band deconstructs; the field re-condenses into translucent PET flakes that slowly fall and tumble, regaining value. |
| 11 – 15 s | **ZEA**     | Everything converges into the ZEA wordmark; the full lockup settles: brand, Chinese line, English line, vision. |

The four scenes are not four shots. Every particle index carries four targets
(`aP0…aP3`) and the shader blends them with three progressive morph weights that
straddle the cuts — so the material never pops, it transforms.

---

## 3. Controls

- **Autoplay** on load, **pause / resume** (button, `space`, or click the canvas)
- **Scrub** the whole 15 s with the transport slider (exact, frame-accurate)
- **Scene jump** 01–04 (`1`–`4` keys or the labelled buttons)
- **Loop** toggle (on by default) / play-once
- **Fullscreen** (`F`) for the trade-show screen
- Keyboard: `←` `→` ±0.2 s (`shift` ±1 s), `L` loop, `F` fullscreen
- Transport auto-hides after ~3 s of inactivity so the screen stays clean

---

## 4. Performance

- Three tiers detected up front (`high` / `mid` / `low`): particle count
  (46k / 20k / 9k), fibre strands, chip instances, DPR cap and MSAA all step
  together.
- `FrameGovernor` watches the rolling frame rate and only ever *shrinks* the
  particle draw range (down to 35 %), then drops the DPR — no popping, no
  oscillation.
- One particle buffer, one `Points` draw call for the whole film; the Möbius
  band, flakes and fibres are a handful of draw calls total. No post-processing
  chain (the glow is additive particles + a shader backdrop), which keeps the
  piece cheap enough for exhibition hardware and phones.
- Portrait phones get a wider FOV and a wordmark auto-fitted to the screen
  width, so the lockup never clips.

---

## 5. Structure

```
index.html                  markup: stage, type layers, transport
src/style.css               graphite / cold-white / glacier system
src/main.ts                 transport loop, input, deep links
src/core/timeline.ts        the 15 s score: scenes, morphs, layer windows
src/core/math.ts            smoothstep / keyframes / seeded PRNG
src/core/quality.ts         tiering + FrameGovernor
src/scene/stage.ts          scene assembly, camera choreography, budget
src/scene/environment.ts    procedural studio PMREM + gradient backdrop
src/scene/fibers.ts         Scene 1 — composite filaments + matrix films
src/scene/mobius.ts         Scene 2 — closed Möbius band (metal/glass)
src/scene/chips.ts          Scene 3 — instanced PET flakes
src/scene/wordmark.ts       Scene 4 — canvas-sampled ZEA targets
src/scene/particles.ts      the single GPU particle system + GLSL
src/ui/hud.ts               transport bar
src/ui/overlay.ts           scene typography + final lockup
tests/                      timeline, geometry and governor specs
```

Everything is driven by one scalar `time` (0–15 s). Scrubbing, looping and scene
jumping all recompute the same pure functions — there is no separate "playing"
state machine to drift out of sync.

---

## 6. Scope

- This repository is standalone. **PHITE OS and NocoBase are untouched.**
- The ZEA production website is not wired to this piece yet.
- V1 delivers the motion system and the preview build; refinement (typeface,
  bloom pass, real PET-scan textures) waits for Owner sign-off.
