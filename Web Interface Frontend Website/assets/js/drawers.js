/* 
drawers.js — Controller for the sliding drawer panels and toggle button.  

What it does:

- Controls the sliding “drawer” panels on the Going Dark page: positions, open/close behavior,
  clipping of overlapped panels, and the top-right toggle button.
- Computes responsive widths from viewport + the left HUD anchor, and uses CSS clip-path to
  reveal only the visible portion of each stacked panel.
- Coordinates animation state (preventing hover flips mid-transition) and runs show/hide
  sequences, including the initial reveal after fonts load. Also fades the spinning term7 logo
  in sync with drawer visibility.

Section map:

1) Tunables / Constants — Timing knobs for transitions, initial delays, and small geometry epsilons.
2) Element References — Caches DOM nodes (drawers, tabs, panels, HUD anchor, toggle, logo).
3) Utility Helpers — CSS variable reader, now(), and small numeric helpers.
4) Layout & Clipping — Calculates drawer positions/sizes; applies clip-path to occlude overlaps; animates to a target depth.
5) Depth / Open-Close — Tracks which drawers are open (depth), toggles classes, and raises the AdGuard drawer when active.
6) Toggle Glyph & Animation State — Locks the toggle’s glyph during animations and debounces hover/transition races.
7) Sequences (Hide/Show + Initial Reveal) — Orchestrates collapse→slide-off and slide-in flows, syncing the logo fade.
8) Init & Resize — Bootstraps hidden state, performs the initial reveal after fonts are ready, and keeps layout correct on resize.
*/

(function () {
  'use strict';

  /* =========================================
     1) Tunables / Constants
     ========================================= */
  const TRANSITION_MS = 360;                 // drawer/toggle slide duration
  const COLLAPSE_DELAY = TRANSITION_MS + 24; // wait until collapse finishes
  const BREAK_AFTER_CLOSE_MS = 140;          // pause between close and slide-off on hide
  const INITIAL_START_DELAY = 140;           // pause before the initial reveal
  const EPS = 1.5;                           // tiny inset when clipping overlapping panels


  /* =========================================
     2) Element References
     ========================================= */
  const root     = document.documentElement;
  const drawers  = Array.from(document.querySelectorAll('.drawer'))
                    .sort((a, b) => (+a.dataset.index) - (+b.dataset.index));
  const tabs     = drawers.map(d => d.querySelector('.tab'));
  const panels   = drawers.map(d => d.querySelector('.panel'));
  const idsSpan  = document.getElementById('ids');             // for measuring left-side anchor
  const toggleEl = document.getElementById('drawer-toggle');   // top-right toggle
  const logoEl   = document.getElementById('gd-logo-wrap');    // spinning logo wrapper (fade only)

  if (!toggleEl || drawers.length === 0) return;


  /* =========================================
     3) Utility Helpers
     ========================================= */
  function cssPxNumber(el, varName, fallback) {
    const v = getComputedStyle(el).getPropertyValue(varName).trim();
    const n = parseFloat(v || '');
    return Number.isFinite(n) ? n : fallback;
  }

  const now = () => performance.now();


  /* =========================================
     4) Layout & Clipping
     ========================================= */
  // Compute widths/positions based on the viewport and the “Target Count” cluster
  function layoutDrawers() {
    const n     = drawers.length;
    const tabW  = cssPxNumber(root, '--tab-w', 36);
    const gapW  = cssPxNumber(root, '--gap-w', 160);
    const vw    = window.innerWidth || document.documentElement.clientWidth || 0;
    const r     = idsSpan ? idsSpan.getBoundingClientRect() : { right: 0 };
    const LBase = Math.max(0, r.right) + gapW;

    drawers.forEach((drawer, i) => {
      const offsetTabs = (n - 1 - i);
      const rightPx    = offsetTabs * tabW;
      drawer.style.right = rightPx + 'px';

      const left_i   = LBase - (offsetTabs * tabW);
      let panelW     = vw - rightPx - tabW - left_i;
      const MIN_W    = 320, MAX_W = Math.max(3600, vw);
      panelW         = Math.max(MIN_W, Math.min(MAX_W, panelW));
      drawer.style.setProperty('--panel-w', panelW + 'px');
      drawer.style.zIndex = String(2 + i);

      const isOpen = i <= depth;
      panels[i]?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  function hideFully(panel) {
    panel.style.visibility = 'hidden';
    panel.style.clipPath = 'inset(0 100% 0 0)';
  }

  function showFull(panel) {
    panel.style.visibility = 'visible';
    panel.style.clipPath = 'inset(0 0 0 0)';
  }

  // Ensure visible panels are set to visible ahead of clip animation
  function preOcclude(nextDepth) {
    const maxActive = Math.max(nextDepth, prevDepth);
    panels.forEach((p, i) => {
      if (!p) return;
      if (i <= maxActive) p.style.visibility = 'visible';
      else                hideFully(p);
    });
  }

  function getRects() {
    return panels.map(p => p.getBoundingClientRect());
  }

  // Clip overlapped panels so only the visible part (to the left) shows
  function applyClipsWithRects(nextDepth, rects) {
    const topIndex  = (nextDepth >= prevDepth) ? nextDepth : prevDepth;
    const maxActive = Math.max(nextDepth, prevDepth);

    panels.forEach((panel, i) => {
      if (!panel) return;
      const rect = rects[i];
      if (i > maxActive) { hideFully(panel); return; }
      if (i === topIndex) { showFull(panel); return; }
      if (i > topIndex)   { showFull(panel); return; }

      let coverLeft = Infinity;
      for (let j = i + 1; j <= maxActive; j++) {
        coverLeft = Math.min(coverLeft, rects[j].left);
      }

      const allowedRight  = Math.min(rect.right, coverLeft - EPS);
      const visibleWidth  = Math.max(0, allowedRight - rect.left);

      if (visibleWidth <= EPS) {
        hideFully(panel);
      } else {
        const rightInset = Math.max(0, Math.ceil(rect.width - visibleWidth));
        panel.style.visibility = 'visible';
        panel.style.clipPath   = `inset(0 ${rightInset}px 0 0)`;
      }
    });
  }

  let rafToken = 0;
  function animateTo(nextDepth, dur = TRANSITION_MS) {
    const token = ++rafToken;
    const start = now();

    function step(t) {
      if (token !== rafToken) return;
      applyClipsWithRects(nextDepth, getRects());
      if (t - start < dur) requestAnimationFrame(step);
      else                 applyClipsWithRects(nextDepth, getRects());
    }

    applyClipsWithRects(nextDepth, getRects());
    requestAnimationFrame(step);
  }


  /* =========================================
     5) Depth / Open-Close
     ========================================= */
  let depth = -1;       // all drawers closed
  let prevDepth = -1;

  function goTo(nextDepth) {
    prevDepth = depth;
    layoutDrawers();
    preOcclude(nextDepth);
    depth = nextDepth;

    drawers.forEach((drawer, i) => {
      drawer.classList.toggle('open', i <= depth);
    });

    // Lift AdGuard drawer above footer when its panel is visible
    document.body.classList.toggle('adg-over-footer', depth >= 2);

    animateTo(nextDepth);
  }

  function onTabClick(i) {
    const next = (depth === i) ? -1 : i;
    goTo(next);
  }

  tabs.forEach((t, i) => t?.addEventListener('click', () => onTabClick(i), { passive: true }));


  /* =========================================
     6) Toggle Glyph & Animation State
     ========================================= */
  // which: 'back' => slashes (/////) visible; 'front' => backslashes (\\\\\) visible
  function setLocked(which) {
    toggleEl.setAttribute('data-locked', which);
    const title = (which === 'back') ? 'Hide drawers' : 'Show drawers';
    toggleEl.setAttribute('title', title);
  }

  // During animations, disable hover flip and color change
  function setAnimating(on, fallbackMs) {
    toggleEl.setAttribute('data-animating', on ? '1' : '0');
    if (!on) return;

    let cleared = false;
    const clear = () => {
      if (cleared) return;
      cleared = true;
      toggleEl.setAttribute('data-animating', '0');
      toggleEl.removeEventListener('transitionend', onEnd);
    };
    const onEnd = (e) => {
      if (e.target === toggleEl && (e.propertyName === 'right' || e.propertyName === 'transform')) {
        clear();
      }
    };
    toggleEl.addEventListener('transitionend', onEnd, { passive: true });
    setTimeout(clear, Math.max(200, fallbackMs | 0)); // safety net
  }


  /* =========================================
     7) Sequences (Hide/Show + Initial Reveal)
     ========================================= */
  let drawersHidden = true; // initial state: offscreen (matches HTML classes)

  // Hide: 1) collapse open drawers → 2) short break → 3) slide offscreen + move toggle
  // We lock the glyph to BACKSLASHES ('front') at the start so it doesn't flip mid-run.
  function hideDrawersSequence() {
    const totalDisable = COLLAPSE_DELAY + BREAK_AFTER_CLOSE_MS + TRANSITION_MS + 140;
    setAnimating(true, totalDisable);

    // Keep the glyph on backslashes during the whole hide sequence
    setLocked('front');

    const startSlideOff = () => {
      drawers.forEach(d => d.classList.add('offscreen'));
      toggleEl.classList.add('at-right');
      logoEl?.classList.add('logo-fade');
      setTimeout(() => { drawersHidden = true; }, TRANSITION_MS);
    };

    if (depth >= 0) {
      goTo(-1); // collapse fully first
      setTimeout(startSlideOff, COLLAPSE_DELAY + BREAK_AFTER_CLOSE_MS);
    } else {
      startSlideOff();
    }
  }

  // Show: slide in drawers + toggle, and show slashes
  function showDrawersSequence() {
    setAnimating(true, TRANSITION_MS + 120);
    setLocked('back'); // slashes visible while bringing drawers in

    drawers.forEach(d => d.classList.remove('offscreen'));
    toggleEl.classList.remove('at-right');
    logoEl?.classList.remove('logo-fade');

    setTimeout(() => { drawersHidden = false; }, TRANSITION_MS);
  }

  toggleEl.addEventListener('click', () => {
    if (!drawersHidden) hideDrawersSequence();
    else                showDrawersSequence();
  }, { passive: true });


  /* =========================================
     8) Init & Resize
     ========================================= */
  // Start with panels hidden (clip + visibility)
  panels.forEach(p => p && hideFully(p));
  layoutDrawers();

  // Initial reveal from offscreen → standard configuration
  const startReveal = () => {
    layoutDrawers();
    setTimeout(showDrawersSequence, INITIAL_START_DELAY);
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(startReveal).catch(startReveal);
  } else {
    setTimeout(startReveal, 50);
  }

  // Keep layout correct on resize
  window.addEventListener('resize', () => {
    layoutDrawers();
    // snap-apply clipping to the current depth without animating
    animateTo(depth, 0);
  }, { passive: true });
})();
