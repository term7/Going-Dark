/* 
adguard.js — Controller for the embedded AdGuard Home iframe and diagnostics cards.

What it does:

- Shows a temporary cover while the AdGuard iframe loads, and hides it after.
- Injects a tiny CSS snippet into the AdGuard iframe to enforce dark theme and hide scrollbars.
- Tracks login state inside the AdGuard iframe (best-effort) and fades the two diagnostics cards
  (Adblock/Fingerprinting + DNS/Tor) plus the handwriting overlay in sync.
- Reacts to SPA route changes, DOM mutations, and uses a lightweight polling fallback.
- Keeps animations smooth by toggling classes in the same animation frame.

Section map:

1) Elements — Grab the iframe and related DOM nodes.
2) Cover Helpers — Show/hide a visual cover during iframe navigation.
3) Iframe CSS Injection — Force dark theme + scrollbar tweaks and hook unload.
4) Iframe Load Handling — Inject on load and hide the cover after a brief delay.
5) Diagnostics Fade Setup — Track state, arm transitions, batch class toggles.
6) State Detection — Infer logged_in / logged_out / unknown from the iframe.
7) State Application — Apply fades only on actual state changes.
8) Watchers — Hashchange, MutationObserver, and polling to keep in sync.
9) Boot — Kick off watchers immediately if already loaded, else on load.

Note: This module is self-contained and interacts only with the AdGuard iframe and
the diagnostics/handwriting elements on the page; no cross-module messaging is required.
*/

// /assets/js/adguard.js
(function () {
  'use strict';

  /* =========================================
     1) Elements
     - Main AdGuard iframe + cover overlay, diagnostics cards, handwriting
     ========================================= */
  // ---------- Elements ----------
  const frame      = document.getElementById('adguard-frame');
  const cover      = document.getElementById('adg-cover');
  const rdCardBot  = document.getElementById('rd-card');       // bottom card (DNS + Tor)
  const rdCardTop  = document.getElementById('rd-card-top');   // top card (Adblock + Fingerprinting)
  const handwrite  = document.getElementById('handwrite-wrap');

  /* =========================================
     2) Cover Helpers
     - Simple opacity toggles for a loading mask
     ========================================= */
  // ---------- Cover helpers (iframe visual) ----------
  function showCover() { if (cover) cover.style.opacity = '1'; }
  function hideCover() { if (cover) cover.style.opacity = '0'; }

  /* =========================================
     3) Iframe CSS Injection
     - Inject a minimal dark theme + hide scrollbars inside the AdGuard UI
     - Also hook beforeunload to show the cover during internal navigations
     ========================================= */
  function injectAdgCSS(ifr) {
    try {
      const doc = ifr.contentDocument || (ifr.contentWindow && ifr.contentWindow.document);
      if (!doc || doc.getElementById('gd-injected')) return;

      const style = doc.createElement('style');
      style.id = 'gd-injected';
      style.textContent = `
        :root { color-scheme: dark; }
        html, body { background: #0e0e10 !important; }
        html, body, * { scrollbar-width: none !important; }
        *::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
        *::-webkit-scrollbar-thumb { background: transparent !important; }
        *::-webkit-scrollbar-track { background: transparent !important; }
      `;
      (doc.head || doc.documentElement).appendChild(style);

      try {
        const win = ifr.contentWindow;
        if (win && !win.__gdUnloadHooked) {
          win.addEventListener('beforeunload', showCover, { capture: true });
          win.__gdUnloadHooked = true;
        }
      } catch (_) {}
    } catch (_) {}
  }

  /* =========================================
     4) Iframe Load Handling
     - Show cover immediately, inject CSS on load, then fade the cover away
     ========================================= */
  if (frame) {
    showCover();
    frame.addEventListener('load', () => {
      injectAdgCSS(frame);
      setTimeout(hideCover, 50);
    });
  }

  // =====================================================================
  // Remote Diagnostics cards + handwriting (fade-ready model) + micro-sync
  // =====================================================================

  /* =========================================
     5) Diagnostics Fade Setup
     - Maintain authoritative state and enable transitions once
     - Batch class toggles via rAF for perfect sync across elements
     ========================================= */
  if (!frame || (!rdCardBot && !rdCardTop)) return;

  let lastState = 'logged_out'; // authoritative state we've already applied
  let armed = false;            // whether we've enabled CSS transitions

  const fadeTargets = [rdCardTop, rdCardBot, handwrite].filter(Boolean);

  function ensureArmed() {
    if (armed) return;
    // Enable transitions for both cards (handwriting picks up via CSS sibling logic)
    if (rdCardTop) rdCardTop.classList.add('fade-ready');
    if (rdCardBot) rdCardBot.classList.add('fade-ready');
    // handwriting transitions are already defined in CSS (tied to fade-ready presence)
    armed = true;
  }

  // Toggle all fade targets in the same animation frame for perfect sync
  function setHidden(hidden) {
    requestAnimationFrame(() => {
      for (const el of fadeTargets) {
        if (hidden) el.classList.add('hidden');
        else el.classList.remove('hidden');
      }
    });
  }

  /* =========================================
     6) State Detection
     - Best-effort inspection: look for password/login fields or logout affordances
     - Works across SPA navigations with URL hints as fallback
     ========================================= */
  // Detect state inside the iframe (best-effort; robust to SPA changes).
  function getAdgState() {
    try {
      const win = frame.contentWindow;
      const doc = frame.contentDocument || (win && win.document);
      if (!doc) return 'unknown';

      // Clear login UI present → logged OUT
      if (doc.querySelector('input[type="password"], form[action*="login"], [data-testid*="login"]')) {
        return 'logged_out';
      }

      // Clear logout affordance present → logged IN
      if (doc.querySelector('a[href*="logout"], button[title*="Logout"], [aria-label*="Logout"]')) {
        return 'logged_in';
      }

      // URL hints commonly used by AdGuard Home
      const href = (win && win.location && win.location.href) || '';
      if (/login/i.test(href)) return 'logged_out';

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /* =========================================
     7) State Application
     - Only react to actual changes (debounce unnecessary)
     - Fade out when logged in, fade in when logged out
     ========================================= */
  function maybeApply() {
    const state = getAdgState();
    if (state === 'unknown' || state === lastState) return;

    // We have a *change* (not the initial page load assumption).
    ensureArmed();

    if (state === 'logged_in') {
      setHidden(true);   // fade OUT both cards + handwriting together
      lastState = 'logged_in';
    } else if (state === 'logged_out') {
      setHidden(false);  // fade IN both cards + handwriting together
      lastState = 'logged_out';
    }
  }

  /* =========================================
     8) Watchers
     - Hashchange (SPA), MutationObserver (DOM swaps), and fallback polling
     ========================================= */
  function startWatching() {
    // 1) React to SPA route changes (hash-based router typical in AdGuard Home)
    try {
      const win = frame.contentWindow;
      if (win) {
        win.addEventListener('hashchange', maybeApply);
      }
    } catch {}

    // 2) React to DOM swaps (login screen <-> dashboard)
    try {
      const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
      if (doc && doc.body) {
        const mo = new MutationObserver(maybeApply);
        mo.observe(doc.body, { subtree: true, childList: true, attributes: true });
      }
    } catch {}

    // 3) Fallback polling (covers cross-origin or missed events)
    setInterval(maybeApply, 1000);

    // Do a first check AFTER load — harmless if still logged out.
    maybeApply();
  }

  /* =========================================
     9) Boot
     - Start watchers immediately if iframe already complete; otherwise on load
     ========================================= */
  // Start watchers when the iframe is ready; also handle reloads
  if (frame.complete) {
    startWatching();
  } else {
    frame.addEventListener('load', startWatching);
  }
})();
