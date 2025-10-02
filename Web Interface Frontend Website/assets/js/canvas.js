/* 
canvas.js — background animation for https://going.dark

What it does (What you’ll see):

- At the very start, there is a single red ball: it is trivially 
  identifiable (100% certain).
- Both the background and the balls smoothly fade back and forth between
  a dark tone and a bright tone — even the red ball, which dims toward 
  invisibility as a proliferation event approaches.
- When the background and the balls’ colors coincide (they visually merge and all 
  balls briefly become invisible), a proliferation event happens:
    • All balls duplicate, appearing visually uniform.
    • The previously red ball is “lost” in the merge, blending back into the crowd.
    • Immediately, the system randomly chooses a new ball to mark red.
- After the first event there are two balls → only a 50% chance the red one 
  is still the original; with three balls, ~33%; with four, 25%; and so on.
- From the outside, your confidence in tracking the original ball steadily erodes.

* * *

This mirrors the idea behind the Tor Browser: when only one person uses it, 
they stand out; but as more users appear and all traffic looks uniform, 
it becomes harder and harder for an observer to know “who is who.” 
The core idea is the loss of confidence in following an “original identity” 
as the crowd grows.

* * *

What it does (Technical description):

A lightweight, self-contained canvas animation that renders drifting balls 
whose brightness follows a smooth “ball wave,” while the page background 
follows a separate “background wave.” When the two waves align, a 
proliferation event is triggered: balls split, one ball enters a staged red 
highlight phase, and a countdown to the next alignment is shown. 

The HUD displays counts, a spinner during low-visibility phases, and a 
confidence readout based on the current ball population. The animation runs 
via requestAnimationFrame and pauses when the page is hidden to save resources.

Section map:

1) Constants / Timings / Physics — Colors, fade periods, red-phase timings, motion speed, FPS; spinner glyphs & cadence.
2) DOM / Canvas — Grabs required DOM nodes (HUD labels, canvas, fade overlay) and 2D context; early bail if missing.
3) Math / Utility Helpers — Small helpers: clamp01, hex↔mix, randoms, vector rotation for motion perturbations.
4) Waves (background & balls) — Two smooth 0..1 envelopes controlling background opacity and ball brightness.
5) Simulation Clock (pause when hidden) — Visibility-aware clock; simulation time advances only when the page is visible.
6) Canvas Sizing / DPR — Responsive canvas sizing with a capped devicePixelRatio for crisp rendering and stable perf.
7) Ball Model & Motion — Ball structure, edge-spawn logic, wall bounces, child spawning, counters for the HUD.
8) Proliferation Timing & Red Phase Scheduling — Chooses the “special” red ball and schedules hold/in/out red stages.
9) Propagation Detection / Reset — Detects color-match moments, clones balls, randomizes next special; hard reset after N events.
10) Colors & Drawing — Computes per-frame colors (including red blends) and draws normal/special balls in a simple z-order.
11) Countdown (next crossing) — Predicts the next color-match and renders a mm:ss countdown in the HUD.
12) Probability String (exact, with repeating part) — Builds a % string via long division, marking any repeating decimal.
13) Tracking UI (spinner + status column) — Shows a spinner during low-visibility/pre-red; else a “Target Confidence” readout.
14) Main Loop / Visibility Handling — rAF step: advance time, update overlay, physics, draw, countdown, HUD; pause/resume handlers.
15) Bootstrap — Initial sizing and spawn, compute first match, kick off the animation loop.
*/

(function () {
  'use strict';

  /* =========================================
     1) Constants / Timings / Physics
     ========================================= */
  const BLACK_HEX = '#2A2A2A';
  const LIGHT_HEX = '#FFF4C7';
  const RED_HEX   = '#ff0000';

  // Background wave timings (ms)
  const UP_MS   = 213000;
  const DOWN_MS = 213000;
  const PERIOD  = UP_MS + DOWN_MS;

  // Ball wave period (ms) + red phase timings
  const BALL_PERIOD_MS = 240000;
  const RED_HOLD_MS = 3000, RED_IN_MS = 3000, RED_OUT_MS = 3000, RED_OUT_PAD = 5000;

  // Render / motion tuning
  const DPR_CAP = 0.65;
  const RADIUS  = 9;
  const SPEED   = 80;

  // Spinner for the tracking UI when background is faded
  const TRACK_SPIN_FRAMES = ['-', '\\', '|', '/'];
  const TRACK_SPIN_INTERVAL_MS = 80;        // typewriter cadence
  const OPACITY_SPIN_THRESHOLD = 0.08;      // "faded out" threshold

  // Animation cadence (canvas)
  const FPS = 30;
  const FRAME_INTERVAL = 1000 / FPS;


  /* =========================================
     2) DOM / Canvas
     ========================================= */
  const fadeEl   = document.getElementById('bg-fade');
  const idsEl    = document.getElementById('ids');
  const anonsEl  = document.getElementById('anons');
  const nextEl   = document.getElementById('next');
  const statusEl = document.getElementById('status');

  const canvas = document.getElementById('balls');
  const ctx    = canvas?.getContext('2d', { alpha: true, desynchronized: true });

  // Bail out if critical elements are missing
  if (!fadeEl || !idsEl || !anonsEl || !nextEl || !statusEl || !canvas || !ctx) return;


  /* =========================================
     3) Math / Utility Helpers
     ========================================= */
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function hexToRgb(h){
    h = h.replace('#','');
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  }
  function mixHex(a, b, t){
    const A = hexToRgb(a), B = hexToRgb(b);
    const r = Math.round(A.r + (B.r - A.r) * t);
    const g = Math.round(A.g + (B.g - A.g) * t);
    const bl= Math.round(A.b + (B.b - A.b) * t);
    return '#' + r.toString(16).padStart(2,'0') + g.toString(16).padStart(2,'0') + bl.toString(16).padStart(2,'0');
  }
  const rand     = (min, max) => min + Math.random() * (max - min);
  const randSign = () => (Math.random() < 0.5 ? -1 : 1);
  function rotateVec(vx, vy, deg){
    const a = deg * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return { vx: vx * c - vy * s, vy: vx * s + vy * c };
  }


  /* =========================================
     4) Waves (background & balls)
     ========================================= */
  function bgWave01(ms) {
    const m = ((ms % PERIOD) + PERIOD) % PERIOD;
    if (m < UP_MS) return 1 - (m / UP_MS);
    return (m - UP_MS) / DOWN_MS;
  }

  function ballWave01(ms){
    const M = BALL_PERIOD_MS;
    const m = ((ms % M) + M) % M;
    const half = M / 2;
    return (m < half) ? (m / half) : (1 - (m - half) / half);
  }


  /* =========================================
     5) Simulation Clock (pause when hidden)
     ========================================= */
  const t0_bg = -UP_MS; // start black

  // Choose initial t0 for the ball wave so the first crossing is never < 30s
  function nextCrossGivenBallT0(candidate_t0_ball, startMs) {
    const STEP = 20, MAX_AHEAD = PERIOD * 2;
    const diffAt = (ms) => ballWave01(ms - candidate_t0_ball) - bgWave01(ms - t0_bg);
    let t = startMs + STEP, prev = diffAt(startMs);
    for (; t <= startMs + MAX_AHEAD; t += STEP) {
      const diff = diffAt(t);
      if (Math.sign(diff) !== Math.sign(prev) || Math.abs(diff) <= 1e-6) {
        let lo = t - STEP, hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const d   = diffAt(mid);
          const dlo = diffAt(lo);
          if (Math.sign(d) === Math.sign(dlo)) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
      }
      prev = diff;
    }
    return startMs + PERIOD / 2;
  }

  const T_BASE_MS = 1 / ((2 / BALL_PERIOD_MS) + (1 / DOWN_MS)); // ~76.76s
  const FIRST_MIN_TARGET = 60000;                          // 1:00
  const FIRST_MAX_TARGET = Math.min(2 * T_BASE_MS, DOWN_MS - 1000);
  const HARD_MIN_FIRST_MS = 30000;                         // never allow < 30s
  const HALF = BALL_PERIOD_MS / 2;

  let t0_ball;
  {
    let bestCand = null, bestNext = -Infinity;
    const ATTEMPTS = 50;
    for (let i = 0; i < ATTEMPTS; i++) {
      const targetFirstMs = Math.round(rand(FIRST_MIN_TARGET, FIRST_MAX_TARGET));
      let deltaMs = HALF * (1 - (targetFirstMs / T_BASE_MS));
      deltaMs = Math.max(-HALF, Math.min(HALF, deltaMs));
      const cand = -HALF + deltaMs;
      const next = nextCrossGivenBallT0(cand, 1);
      if (next >= HARD_MIN_FIRST_MS) { t0_ball = cand; break; }
      if (next > bestNext) { bestNext = next; bestCand = cand; }
    }
    if (t0_ball === undefined) t0_ball = bestCand; // fallback
  }

  let simTime = 0;                        // ms advanced only while visible
  let lastFrameClock = performance.now(); // wall-clock of last rAF
  let paused = false;

  const bgOpacityAt   = (ms) => bgWave01(ms - t0_bg);
  const ballOpacityAt = (ms) => ballWave01(ms - t0_ball);


  /* =========================================
     6) Canvas Sizing / DPR
     ========================================= */
  const DPR = () => Math.min((window.devicePixelRatio || 1), DPR_CAP);
  let dpr = 1, W = 1, H = 1;

  function resize(){
    const bw = window.innerWidth, bh = window.innerHeight;
    dpr = DPR();
    canvas.width  = Math.floor(bw * dpr);
    canvas.height = Math.floor(bh * dpr);
    canvas.style.width  = bw + 'px';
    canvas.style.height = bh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = bw; H = bh;
  }
  window.addEventListener('resize', resize, { passive: true });


  /* =========================================
     7) Ball Model & Motion
     ========================================= */
  let balls = [];
  let propagationEvents = 0;

  function updateCounter(){
    idsEl.textContent   = String(balls.length);
    anonsEl.textContent = String(propagationEvents);
  }

  function bounce(b){
    if (b.x - RADIUS <= 0 && b.vx < 0) { b.x = RADIUS;   b.vx = -b.vx; }
    else if (b.x + RADIUS >= W && b.vx > 0) { b.x = W-RADIUS; b.vx = -b.vx; }
    if (b.y - RADIUS <= 0 && b.vy < 0) { b.y = RADIUS;   b.vy = -b.vy; }
    else if (b.y + RADIUS >= H && b.vy > 0) { b.y = H-RADIUS; b.vy = -b.vy; }
  }

  function spawnChildFrom(b){
    const offset = rand(1, 30) * randSign();
    const r = rotateVec(b.vx, b.vy, offset);
    const len = Math.hypot(r.vx, r.vy) || 1;
    const vx = (r.vx / len) * SPEED;
    const vy = (r.vy / len) * SPEED;
    const child = { x: b.x, y: b.y, vx, vy, special: false };
    balls.push(child);
    return child;
  }

  function spawnInitialBall(){
    const edge = Math.floor(Math.random() * 4);
    let x, y, vx, vy;

    switch (edge){
      case 0: x = Math.random()*W; y = -RADIUS+1;       vx = rand(-1, 1);     vy = rand(0.25, 1);   break;
      case 1: x = W+RADIUS-1;      y = Math.random()*H; vx = rand(-1, -0.25); vy = rand(-1, 1);     break;
      case 2: x = Math.random()*W; y = H+RADIUS-1;      vx = rand(-1, 1);     vy = rand(-1, -0.25); break;
      default: // 3
        x = -RADIUS+1; y = Math.random()*H; vx = rand(0.25, 1); vy = rand(-1, 1);
    }
    const len = Math.hypot(vx, vy) || 1;
    vx = (vx / len) * SPEED;
    vy = (vy / len) * SPEED;

    const b = { x, y, vx, vy, special: true };
    scheduleFirstRed(b, simTime);
    b.specialZ = 0;

    balls = [b];
    updateCounter();
  }


  /* =========================================
     8) Proliferation Timing & Red Phase Scheduling
     ========================================= */
  function findNextCrossTime(startMs){
    const STEP = 20, MAX_AHEAD = PERIOD * 2;
    let t = startMs + STEP;
    let prev = ballOpacityAt(startMs) - bgOpacityAt(startMs);

    for (; t <= startMs + MAX_AHEAD; t += STEP) {
      const diff = ballOpacityAt(t) - bgOpacityAt(t);
      if (Math.sign(diff) !== Math.sign(prev) || Math.abs(diff) <= 1e-6) {
        let lo = t - STEP, hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const d = ballOpacityAt(mid) - bgOpacityAt(mid);
          if (Math.sign(d) === Math.sign(ballOpacityAt(lo) - bgOpacityAt(lo))) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      }
      prev = diff;
    }
    return startMs + PERIOD / 2;
  }

  let nextCrossMs = 0;

  function scheduleFirstRed(ball, nowMs){
    const nextCross = findNextCrossTime(nowMs + 1);
    ball.special = true;
    ball.redPhase = 'red';
    ball.redOutEnd   = nextCross - RED_OUT_PAD;
    ball.redOutStart = ball.redOutEnd - RED_OUT_MS;
    ball.specialZ    = Math.floor(Math.random() * Math.max(1, balls.length - 1));
  }

  function scheduleRedPhases(ball, nowMs){
    const nx = findNextCrossTime(nowMs + 1);
    ball.special = true; ball.redPhase = 'phased';
    ball.holdStart = nowMs;               ball.holdEnd   = nowMs + RED_HOLD_MS;
    ball.redInStart= ball.holdEnd;        ball.redInEnd  = ball.redInStart + RED_IN_MS;
    ball.redInStartColor = globalBallColor(nowMs);
    ball.solidRedStart   = ball.redInEnd;
    ball.redOutEnd       = Math.max(ball.solidRedStart + 500, nx - RED_OUT_PAD);
    ball.redOutStart     = Math.max(ball.solidRedStart, ball.redOutEnd - RED_OUT_MS);
    ball.solidRedEnd     = ball.redOutStart;
    ball.specialZ        = Math.floor(Math.random() * Math.max(1, balls.length - 1));
  }


  /* =========================================
     9) Propagation Detection / Reset
     ========================================= */
  let prevDiff = 0, lastCrossMs = 0;

  function randomizeNextSpecial(nowMs){
    for (const b of balls) b.special = false;
    const idx = Math.floor(Math.random() * balls.length);
    scheduleRedPhases(balls[idx], nowMs);
  }

  function resetAll(nowMs){
    balls.length = 0;
    propagationEvents = 0;
    prevDiff = ballOpacityAt(nowMs) - bgOpacityAt(nowMs);
    lastCrossMs = nowMs;
    spawnInitialBall();
    nextCrossMs = findNextCrossTime(nowMs + 1);
    updateCounter();
  }

  function checkEquality(nowMs){
    const diff = ballOpacityAt(nowMs) - bgOpacityAt(nowMs);
    const crossed = (Math.sign(diff) !== Math.sign(prevDiff)) || (Math.abs(diff) <= 1e-6);
    const cooldownOk = (nowMs - lastCrossMs) > 250;

    if (crossed && cooldownOk){
      propagationEvents++;
      if (propagationEvents >= 14) { resetAll(nowMs); return; } // show 13, reset on 14th
      const currentCount = balls.length;
      for (let i = 0; i < currentCount; i++) spawnChildFrom(balls[i]);
      randomizeNextSpecial(nowMs);
      updateCounter();
      lastCrossMs = nowMs;
      nextCrossMs = findNextCrossTime(nowMs + 1);
    }
    prevDiff = diff;
  }


  /* =========================================
     10) Colors & Drawing
     ========================================= */
  function globalBallColor(nowMs){
    return mixHex(BLACK_HEX, LIGHT_HEX, ballOpacityAt(nowMs));
  }

  function draw(nowMs){
    ctx.clearRect(0, 0, W, H);

    const special = balls.find(b => b.special);
    const normals = balls.filter(b => !b.special);
    const z = special ? Math.max(0, Math.min(normals.length, special.specialZ | 0)) : 0;

    for (let i = 0; i < normals.length; i++){
      if (special && i === z) drawSpecial(special, nowMs);
      const b = normals[i];
      ctx.fillStyle = globalBallColor(nowMs);
      ctx.beginPath(); ctx.arc(b.x, b.y, RADIUS, 0, Math.PI * 2); ctx.fill();
    }
    if (special && z >= normals.length) drawSpecial(special, nowMs);
  }

  function drawSpecial(special, nowMs){
    let fill; const n = nowMs;

    if (special.redPhase === 'red') {
      if (n < special.redOutStart) fill = RED_HEX;
      else if (n <= special.redOutEnd) {
        const t = clamp01((n - special.redOutStart) / Math.max(1, (special.redOutEnd - special.redOutStart)));
        fill = mixHex(RED_HEX, globalBallColor(n), t);
      } else fill = globalBallColor(n);
    } else {
      if (n <= special.holdEnd) fill = globalBallColor(n);
      else if (n <= special.redInEnd) {
        const t = clamp01((n - special.redInStart) / Math.max(1, (special.redInEnd - special.redInStart)));
        const startCol = special.redInStartColor || globalBallColor(special.redInStart);
        fill = mixHex(startCol, RED_HEX, t);
      } else if (n < special.solidRedEnd) fill = RED_HEX;
      else if (n <= special.redOutEnd) {
        const t = clamp01((n - special.redOutStart) / Math.max(1, (special.redOutEnd - special.redOutStart)));
        fill = mixHex(RED_HEX, globalBallColor(n), t);
      } else fill = globalBallColor(n);
    }

    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(special.x, special.y, RADIUS, 0, Math.PI * 2); ctx.fill();
  }


  /* =========================================
     11) Countdown (next crossing)
     ========================================= */
  function fmtCountdown(ms){
    ms = Math.max(0, ms | 0);
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const pad2 = (n) => String(n).padStart(2, '0');
    return `${m}:${pad2(s)}`;
  }

  function updateCountdown(nowMs){
    if (!isFinite(nextCrossMs) || nextCrossMs <= nowMs) nextCrossMs = findNextCrossTime(nowMs + 1);
    nextEl.textContent = fmtCountdown(nextCrossMs - nowMs);
  }


  /* =========================================
     12) Probability String (exact, with repeating part)
     ========================================= */
  function probabilityPercentString(count){
    const den = BigInt(Math.max(1, count));
    let num = 100n; // 100%

    const intPart = num / den;
    let rem = num % den;
    if (rem === 0n) return intPart.toString(); // exact integer %

    const digits = [];
    const seen = new Map(); // remainder -> index
    let repeatStart = -1;

    while (rem !== 0n && digits.length < 200) { // guard against runaway
      const key = rem.toString();
      if (seen.has(key)) { repeatStart = seen.get(key); break; }
      seen.set(key, digits.length);
      rem *= 10n;
      const d = rem / den;
      digits.push(d.toString());
      rem = rem % den;
    }

    if (rem === 0n) {
      return intPart.toString() + '.' + digits.join('');
    } else {
      const a = digits.slice(0, repeatStart).join('');
      const b = digits.slice(repeatStart).join('');
      return intPart.toString() + '.' + a + '(' + b + ')';
    }
  }


  /* =========================================
     13) Tracking UI (spinner + status column)
     ========================================= */
  function updateTrackingVisuals(nowMs){
    const special = balls.find(b => b.special);

    // Spinner lasts until red fade-in begins (for 'phased'), or while faded out otherwise.
    let spinnerActive;
    if (special && special.redPhase === 'phased') {
      spinnerActive = nowMs < special.redInStart;
    } else {
      spinnerActive = ballOpacityAt(nowMs) <= OPACITY_SPIN_THRESHOLD;
    }

    if (spinnerActive) {
      const idx = Math.floor(nowMs / TRACK_SPIN_INTERVAL_MS) % TRACK_SPIN_FRAMES.length;
      idsEl.textContent = TRACK_SPIN_FRAMES[idx]; // ONLY spinner char
      statusEl.textContent = '';                  // blank during spinner
    } else {
      idsEl.textContent = String(balls.length || 0);

      // Show probability from the instant fade-in starts, and thereafter
      const pctStr = probabilityPercentString(balls.length);
      statusEl.textContent = `->        Target Confidence: ${pctStr}%`;
    }
  }


  /* =========================================
     14) Main Loop / Visibility Handling
     ========================================= */
  function step(nowClock){
    if (paused) { lastFrameClock = nowClock; requestAnimationFrame(step); return; }

    const deltaClock = nowClock - lastFrameClock;
    if (deltaClock >= FRAME_INTERVAL){
      const dt = deltaClock / 1000;     // seconds
      simTime += deltaClock;            // ms

      fadeEl.style.opacity = String(bgOpacityAt(simTime));
      checkEquality(simTime);

      for (const b of balls) { b.x += b.vx * dt; b.y += b.vy * dt; bounce(b); }

      draw(simTime);
      updateCountdown(simTime);
      updateTrackingVisuals(simTime);

      lastFrameClock = nowClock;
    }
    requestAnimationFrame(step);
  }

  function setPaused(p){ paused = p; lastFrameClock = performance.now(); }
  document.addEventListener('visibilitychange', () => setPaused(document.hidden));
  window.addEventListener('pageshow',  () => setPaused(false));
  window.addEventListener('pagehide',  () => setPaused(true));


  /* =========================================
     15) Bootstrap
     ========================================= */
  function start(){
    resize();
    spawnInitialBall();

    prevDiff    = ballOpacityAt(simTime) - bgOpacityAt(simTime);
    lastCrossMs = simTime;
    nextCrossMs = findNextCrossTime(simTime + 1);

    updateCounter();
    updateCountdown(simTime);
    updateTrackingVisuals(simTime);

    lastFrameClock = performance.now();
    requestAnimationFrame(step);
  }

  start();
})();
