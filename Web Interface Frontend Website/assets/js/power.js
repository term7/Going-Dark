/*
power.js — Main-site power/health controller for the /config/ iframe.

What it does:

- Polls a health endpoint (/config/health) on a steady cadence.
- Applies a global dim/undim UX by toggling the 'power-dim' class on <body>.
- Listens for postMessage events from the /config/ iframe (sent by config.js §8)
  to dim instantly on shutdown/reboot button submits.
- When the backend comes back healthy, refreshes the /config/ iframe to avoid
  showing stale JSON responses, then undims.

Section map:

1) Config / Constants — Origin, health URL, timing & debounce.
2) State — OK/down streak counters and the current dim flag.
3) DOM/Style Helper — setDimmed() toggles 'power-dim' only on changes.
4) Fetch Helper — fetchWithTimeout() wraps fetch with AbortController.
5) Health Probe — backendIsOK() checks JSON or text responses robustly.
6) Iframe Refresh — reloadConfigIframe() cache-busts the /config/ iframe.
7) Poll Tick — tick() combines health results with streak logic + UX changes.
8) postMessage Listener — onMessage() reacts to {type:'power',action} from config.js.
9) Iframe Load Listener — onConfigLoad() ensures undim after a successful reload.
10) Bootstrapping — Start polling, wire listeners for message/online/visibility.
*/

/* =========================================
   1) Config / Constants
   ========================================= */
(() => {
  const ORIGIN = window.location.origin;

  // Your working health endpoint
  const HEALTH_URL = '/config/health';

  // Polling cadence and debounce
  const POLL_MS = 1000;
  const TIMEOUT_MS = 800;
  const OK_STREAK_REQUIRED = 2;   // need 2 consecutive OKs to undim
  const DOWN_STREAK_REQUIRED = 1; // one miss dims immediately

  /* =========================================
     2) State
     ========================================= */
  let okStreak = 0;
  let downStreak = 0;
  let isDimmed = false;

  /* =========================================
     3) DOM/Style Helper
     - Only toggle class when state actually changes (prevents flicker).
     ========================================= */
  // Helper: toggle the class on <body> only on changes (prevents flicker)
  function setDimmed(on) {
    if (on === isDimmed) return;
    isDimmed = on;
    document.body.classList.toggle('power-dim', on);
  }

  /* =========================================
     4) Fetch Helper
     - No-store, same-origin, with timeout via AbortController.
     ========================================= */
  function fetchWithTimeout(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal })
      .finally(() => clearTimeout(t));
  }

  /* =========================================
     5) Health Probe
     - Accepts JSON ({status:'ok'}) or plain text ('OK'/'OK!').
     - Returns boolean; any exception counts as not OK.
     ========================================= */
  async function backendIsOK() {
    try {
      const r = await fetchWithTimeout(HEALTH_URL);
      if (!r.ok) return false;
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        const j = await r.json().catch(() => ({}));
        return (j && String(j.status || '').toLowerCase() === 'ok');
      }
      const t = (await r.text()).trim().toUpperCase();
      return (t === 'OK' || t === 'OK!');
    } catch {
      return false;
    }
  }

  /* =========================================
     6) Iframe Refresh
     - Cache-busts the /config/ iframe when backend becomes healthy.
     - CSP-safe: uses attribute swap, no inline JS.
     ========================================= */
  function reloadConfigIframe() {
    const ifr = document.getElementById('config');
    if (!ifr) return;
    try {
      const url = new URL(ifr.getAttribute('src') || '/config/', ORIGIN);
      url.searchParams.set('_', Date.now().toString());
      // Avoid inline JS; simple src swap is CSP-safe
      ifr.setAttribute('src', url.pathname + url.search);
    } catch {
      // last resort
      ifr.setAttribute('src', '/config/?_=' + Date.now());
    }
  }

  /* =========================================
     7) Poll Tick
     - Combines health result with streak thresholds.
     - Undims after OK_STREAK_REQUIRED consecutive OKs (and refreshes iframe on recovery).
     - Dims immediately after DOWN_STREAK_REQUIRED misses.
     ========================================= */
  async function tick() {
    const ok = await backendIsOK();

    if (ok) {
      okStreak++; downStreak = 0;
      if (okStreak >= OK_STREAK_REQUIRED) {
        if (isDimmed) reloadConfigIframe();  // reload only when recovering
        setDimmed(false);                     // fade in
      }
    } else {
      downStreak++; okStreak = 0;
      if (downStreak >= DOWN_STREAK_REQUIRED) {
        setDimmed(true);                      // fade out
      }
    }
  }

  /* =========================================
     8) postMessage Listener
     - Interaction with config.js §8 Power Actions Intercept.
     - Accept message if same-origin OR if it came from the #config iframe's window.
       (This keeps it working even with different scheme/port/host combos.)
     - The /config/ iframe posts {type:'power', action:'shutdown'|'reboot'|'cancel'}.
     ========================================= */
  // Listen for explicit messages from /config/ iframe to dim immediately
  function onMessage(evt) {
    const cfg = document.getElementById('config');
    const fromConfigIframe = !!(cfg && cfg.contentWindow && evt.source === cfg.contentWindow);
    const sameOrigin = (evt.origin === ORIGIN);
    if (!sameOrigin && !fromConfigIframe) return;

    const { type, action } = evt.data || {};
    if (type !== 'power') return;

    if (action === 'shutdown' || action === 'reboot') {
      okStreak = 0; downStreak = DOWN_STREAK_REQUIRED; // force a dim on next tick
      setDimmed(true);
    } else if (action === 'cancel') {
      downStreak = 0; okStreak = OK_STREAK_REQUIRED;   // force an undim on next tick
      setDimmed(false);
    }
  }

  /* =========================================
     9) Iframe Load Listener
     - After we refresh the src, once the iframe finishes loading,
       it's safe to undim immediately if we were dimmed.
     ========================================= */
  // If the config iframe loads (after we refreshed src), ensure we’re undimmed
  function onConfigLoad() {
    if (!isDimmed) return;
    // The iframe actually loaded; safe to undim
    setDimmed(false);
  }

  /* =========================================
     10) Bootstrapping
     - Kick off polling immediately; rely on class toggle for UX.
     - Wire up listeners: iframe load, postMessage, online, visibilitychange.
     ========================================= */
  document.addEventListener('DOMContentLoaded', () => {
    // Start dimmed if health is not OK yet (first tick will fix state)
    // No inline style — we just rely on the class switch.
    tick().finally(() => {
      setInterval(tick, POLL_MS);
    });

    const cfg = document.getElementById('config');
    if (cfg) cfg.addEventListener('load', onConfigLoad, { passive: true });

    window.addEventListener('message', onMessage, false);
    window.addEventListener('online', () => setTimeout(tick, 50), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) setTimeout(tick, 50);
    }, { passive: true });
  });
})();
