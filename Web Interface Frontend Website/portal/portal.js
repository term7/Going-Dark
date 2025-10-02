/*
portal.js — Frontend controller for the network control portal.

What it does:

- Orchestrates Wi-Fi scans and connect/disconnect flows with progress feedback.
- Toggles WireGuard and Tor (mutually exclusive) and auto-reconnects WG when appropriate.
- Drives hotspot UX (activate/deactivate, update SSID/password, live client count, QR).
- Shows current public IP, user agent, and geolocation, with resilient fallbacks.
- Uses tight polling windows, abortable fetches, and lightweight text spinners to stay responsive on flaky networks.

Section map:

1) Config / Constants — Timing knobs for scanning, stabilization, IP checks, and spinners.
2) State — Central flags for scans, services, IP/Geo, hotspot polling, and UI locks.
3) DOM Helpers — Query, timing, escaping, IPv4 checks, label cleanup.
4) Spinners — Text/arrow spinners that require no external assets.
5) Status Line — “Available/Scanning” messaging with a countdown to the next scan.
6) iw Scan Helpers — Trigger scans, poll results, and update the SSID <select> only when useful.
7) IP / UA / Geo UI — Layout and populate IP/Geo/UA display.
8) Fetch Helpers / Abort Guards — Time-boxed, abortable requests to prevent stale overwrites.
9) IP Detection Flows — Choose server/client strategies based on Tor/WG state.
10) Geolocation — Server-assisted lookup with clear “checking/unavailable” states.
11) WireGuard Autoconnect — Bring WG up automatically when it’s configured and safe to do so.
12) Wi-Fi Connect / Disconnect — Form handlers; spinners; label updates; IP/Geo refresh.
13) Scan Pause/Resume — User and auto-pause windows around operations.
14) Service Controls (WG/Tor/Hotspot) — Button handlers; stabilize then run the right IP flow.
15) Ticker & Connected Labels — Periodic housekeeping and highlighting of the active SSID.
16) Hotspot Clients Polling — Lightweight loop to refresh client counts when active.
17) Bootstrapping — Bind listeners, initial fetches, start timers and first scans.
18) Password Visibility Toggles — Accessible eye-button for password fields.
*/

(function () {
  'use strict';

  /* =========================================
     1) Config / Constants
     ========================================= */
  const SCAN_INTERVAL_MS = 25000;

  // polling for iw scan completion
  const POLL_INTERVAL_MS = 500;
  const POLL_MAX_WAIT_MS = 8000;

  // UI spinners
  const SPIN_FRAMES = ['-', '\\', '|', '/'];
  const SPIN_INTERVAL_MS = 110;
  const ARROW_INTERVAL_MS = 140;

  // service stabilization loop
  const SVC_STABLE_POLL_MS = 300;
  const SVC_STABLE_TIMEOUT_MS = 60000;
  const SVC_STABLE_SECOND_CHANCE_MS = 30000;

  // server-side IP (pageload & fallback)
  const IP_TOTAL_SERVER_MS = 12000;
  const IP_PER_ATTEMPT_SERVER = 6000;
  const IP_GRACE_WG_MS = 600;

  // client-side IP races
  const PAGELOAD_TOR_ENDPOINTS = [
    { url: 'https://ipinfo.io/json',         type: 'json', accept: 'application/json' },
    { url: 'https://ipv4.icanhazip.com',     type: 'text', accept: 'text/plain' }
    
  ];
  const TOR_UP_ENDPOINTS = [
    { url: 'https://api64.ipify.org?format=json', type: 'json', accept: 'application/json' },
    { url: 'https://ipinfo.io/json',              type: 'json', accept: 'application/json' },
    // fallback if others time out
    { url: 'https://ipv4.icanhazip.com',          type: 'text', accept: 'text/plain' }
  ];
  const IP_TOTAL_TOR_MS = 60000;
  const IP_PER_ATTEMPT_TOR = 12000;
  const IP_GRACE_TOR_MS = 1200;
  const SUSPECT_FAST_MS = 250;

  // short pageload client probe (only when torproxy:true)
  const IP_TOTAL_PAGELOAD_CLIENT_MS = 6000;
  const IP_PER_ATTEMPT_PAGELOAD_CLIENT = 4000;

  // hotspot clients polling
  const HOTSPOT_CLIENTS_POLL_MS = 2000;


  /* =========================================
     2) State
     ========================================= */
  let paused = false;
  let pausedByUser = false;
  let autoPausedUntil = 0;

  let inFlight = false;
  let nextScanAt = 0;
  let scanAbort = null;

  let svcState = { hotspot: false, wireguard: false, torproxy: false, wg_configured: false, wg_autoconnect: false };
  let wifiConnected = false; // Track Wi-Fi connectivity for WG/Tor availability

  const _spinTimers = Object.create(null);
  let lastNetCount = null;

  // IP/Geo state
  let ipCheckAbort = null;
  let lastGoodIp = null;
  let geoAbort = null;

  // Hotspot UI guards/state
  let hotspotUiLock = false;
  let clientsTimer = null;
  let lastClientsCount = 0;

  // Track hover state to request exact QR color from server
  let qrHover = false;

  // Record service states at the moment of Wi-Fi disconnect
  let torWasOnAtDisconnect = false;
  let wgAutoAtDisconnect = false;

  // Prevent applySvcStatusFromState from changing buttons during service ops
  let svcButtonsLocked = false;


  /* =========================================
     3) DOM Helpers
     ========================================= */
  const $ = (id) => document.getElementById(id);
  const nowMs = () => Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const stripConnectedTag = (t) =>
    (t || '').replace(/\s*\(connected\)\s*$/i, '').replace(/\s*\(connected\)/i, '');

  const escapeHtml = (s) => {
    const t = document.createElement('textarea');
    t.textContent = s || '';
    return t.innerHTML;
  };

  const isIPv4 = (s) =>
    /^\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\s*$/.test(s || '');


  /* =========================================
     4) Spinners
     ========================================= */
  function startTextSpinner(elId) {
    const el = $(elId);
    if (!el || _spinTimers[elId]) return;
    if (el.dataset) el.dataset._savedText = el.textContent || '';
    _spinTimers[elId] = setInterval(() => {
      const idx = Math.floor(Date.now() / SPIN_INTERVAL_MS) % SPIN_FRAMES.length;
      el.textContent = SPIN_FRAMES[idx];
    }, SPIN_INTERVAL_MS);
  }

  function stopSpinner(elId, restoreText = true) {
    const el = $(elId);
    if (_spinTimers[elId]) {
      clearInterval(_spinTimers[elId]);
      delete _spinTimers[elId];
    }
    if (el) {
      el.style.whiteSpace = '';
      const saved = (el.dataset && el.dataset._savedText) ? el.dataset._savedText : '';
      el.textContent = restoreText ? saved : '';
      if (el.dataset) delete el.dataset._savedText;
    }
  }

  function startArrowSpinner(elId) {
    const el = $(elId);
    if (!el || _spinTimers[elId]) return;
    const NBSP = '\u00A0';
    if (el.dataset) el.dataset._savedText = el.textContent || '';
    el.style.whiteSpace = 'pre';
    let phase = 'build', len = 0, eraseIdx = 0;
    _spinTimers[elId] = setInterval(() => {
      const MAX = 5;
      if (len > MAX) len = MAX;
      if (phase === 'build') {
        len += 1;
        if (len >= MAX) { len = MAX; phase = 'erase'; eraseIdx = 0; }
        el.textContent = '>'.repeat(len);
      } else {
        const leftSpaces = NBSP.repeat(eraseIdx);
        const rightArrows = '>'.repeat(Math.max(0, MAX - eraseIdx));
        el.textContent = leftSpaces + rightArrows;
        eraseIdx += 1;
        if (eraseIdx > MAX) { phase = 'build'; len = 0; el.textContent = ''; }
      }
    }, ARROW_INTERVAL_MS);
  }


  /* =========================================
     5) Status Line
     ========================================= */
  function scheduleNextScan(delayMs) {
    nextScanAt = nowMs() + Math.max(0, delayMs | 0);
  }

  function networksLabel() {
    if (lastNetCount == null) return '… networks';
    return (lastNetCount === 1) ? '1 network' : (lastNetCount + ' networks');
  }

  function formatMMSS(msRemain) {
    const total = Math.max(0, Math.ceil(msRemain / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return mm + ':' + ss;
  }

  function refreshStatusLine() {
    const baseEl = $('scan-base');
    const dynEl = $('scan-dynamic');
    if (!baseEl || !dynEl) return;

    baseEl.textContent = inFlight ? 'Scanning: ' : 'Available: ';

    if (paused) {
      stopSpinner('scan-dynamic', false);
      dynEl.innerHTML = '<b>' + networksLabel() + '</b> · Scans paused';
      return;
    }

    if (inFlight) {
      if (!_spinTimers['scan-dynamic']) {
        dynEl.textContent = '';
        startArrowSpinner('scan-dynamic');
      }
    } else {
      stopSpinner('scan-dynamic', false);
      const remain = Math.max(0, nextScanAt - nowMs());
      dynEl.innerHTML = '<b>' + networksLabel() + '</b> · Next scan in ' + formatMMSS(remain);
    }
  }


  /* =========================================
     6) iw Scan Helpers
     ========================================= */
  async function fetchIwDumpOptions(signal) {
    const resp = await fetch('scan_iw_dump?b=' + nowMs(), { cache: 'no-store', signal: signal });
    if (!resp.ok) throw new Error('iw dump failed');

    const htmlOptions = await resp.text();

    const tmp = document.createElement('select');
    tmp.innerHTML = htmlOptions;
    const ssids = new Set();
    for (let i = 0; i < tmp.options.length; i++) ssids.add(tmp.options[i].value);
    lastNetCount = ssids.size;

    return { htmlOptions: htmlOptions, ssids: ssids };
  }

  function isThinResult(ssids) {
    const curEl = $('current-ssid');
    const connected = (curEl && curEl.textContent) || '';
    if (ssids.size === 0) return true;
    if (ssids.size === 1 && connected && ssids.has(connected)) return true;
    return false;
  }

  function currentSSIDSet() {
    const sel = $('ssid');
    const set = new Set();
    if (!sel) return set;
    for (let i = 0; i < sel.options.length; i++) set.add(sel.options[i].value);
    return set;
  }

  function cancelScanIfAny() {
    if (scanAbort) { try { scanAbort.abort(); } catch (e) {} scanAbort = null; }
    if (inFlight) inFlight = false;
    refreshStatusLine();
  }

  async function triggerBackgroundScan(forcePopulate) {
    if (forcePopulate == null) forcePopulate = false;
    if (paused || inFlight) return;
    const sel = $('ssid');
    if (!sel) return;

    inFlight = true;

    // Ensure Wi-Fi scan spinner shows during background scans
    const dynEl = $('scan-dynamic');
    if (dynEl) {
      dynEl.textContent = '';
      startArrowSpinner('scan-dynamic');
    }

    refreshStatusLine();
    scanAbort = new AbortController();

    try {
      try { await fetch('bgscan_iw', { method: 'POST', cache: 'no-store' }); } catch (e) {}

      const baseline = currentSSIDSet();
      const start = nowMs();

      while (inFlight && (nowMs() - start) < POLL_MAX_WAIT_MS) {
        await sleep(POLL_INTERVAL_MS);
        if (!inFlight) break;

        let data;
        try {
          data = await fetchIwDumpOptions(scanAbort.signal);
          refreshStatusLine();
        } catch (e) {
          if (e && e.name === 'AbortError') break;
          continue;
        }

        if (!forcePopulate && isThinResult(data.ssids)) continue;

        let differs = (baseline.size !== data.ssids.size);
        if (!differs) {
          for (const v of baseline) { if (!data.ssids.has(v)) { differs = true; break; } }
        }

        if (differs || baseline.size === 0 || forcePopulate) {
          sel.innerHTML = data.htmlOptions;
          break;
        }
      }
    } finally {
      inFlight = false;
      scanAbort = null;

      // Stop the spinner explicitly at the end of the scan
      stopSpinner('scan-dynamic', false);

      if (!paused) scheduleNextScan(SCAN_INTERVAL_MS); else nextScanAt = 0;
      refreshStatusLine();
    }
  }


  /* =========================================
     7) IP / UA / Geo UI
     ========================================= */
  function ensureIpGeoLayout() {
    const host = $('ipgeo-status');
    if (!host) return;
    if ($('ip-line') && $('ua-line') && $('geo-line')) return;

    host.innerHTML = [
      '<span id="ip-line"></span>',
      '<br/><br/>',
      '<span id="ua-line">User Agent (UA): <span id="ua-text"></span></span>',
      '<br/><br/>',
      '<span id="geo-line"></span>'
    ].join('');

    const uaText = $('ua-text');
    if (uaText) uaText.textContent = (typeof navigator !== 'undefined' && navigator && navigator.userAgent) ? navigator.userAgent : '';
  }

  function setIpChecking() {
    const ipLine = $('ip-line');
    if (!ipLine) return;

    ipLine.innerHTML = 'Checking: <span id="ip-spinner"></span>';
    startArrowSpinner('ip-spinner');

    const gl = $('geo-line');
    if (gl) {
      gl.style.color = 'red';
      gl.innerHTML = 'Checking: <span id="geo-spinner"></span>';
      startArrowSpinner('geo-spinner');
    }
  }

  function setIpGeoResolved(ip, errMsg) {
    if (errMsg == null) errMsg = '';
    stopSpinner('ip-spinner', false);

    const ipLine = $('ip-line');
    const gl = $('geo-line');

    if (ipLine) {
      if (errMsg) {
        // Capitalized and bold "Unavailable"
        ipLine.innerHTML = 'Your current IP-address is: <b>Unavailable (' + escapeHtml(errMsg) + ')</b>';
        if (gl) {
          stopSpinner('geo-spinner', false);
          gl.style.color = 'red';
          // Also show bold Unavailable (no IP)
          gl.innerHTML = 'Geolocation: <b>Unavailable (no IP)</b>';
        }
        return;
      } else {
        ipLine.innerHTML = 'Your current IP-address is: <b id="ip-addr"></b>';
        const ipEl = $('ip-addr');
        if (ipEl) ipEl.textContent = ip || 'Unavailable';
      }
    }

    if (ip && isIPv4(ip)) {
      requestServerGeo(ip);
    } else if (gl) {
      stopSpinner('geo-spinner', false);
      gl.style.color = 'red';
      // Capitalized and bold Unavailable (no IP)
      gl.innerHTML = 'Geolocation: <b>Unavailable (no IP)</b>';
    }
  }


  /* =========================================
     8) Fetch Helpers / Abort Guards
     ========================================= */
  async function fetchWithTimeout(url, ms, signal, headers) {
    if (headers == null) headers = null;
    const ctrl = new AbortController();
    const t = setTimeout(function(){ try { ctrl.abort(); } catch (e) {} }, ms);
    let extHandler = null;

    try {
      if (signal) {
        if (signal.aborted) {
          const e = new Error('Aborted');
          e.name = 'AbortError';
          throw e;
        }
        extHandler = function(){ try { ctrl.abort(); } catch (e) {} };
        try { signal.addEventListener('abort', extHandler, { once: true }); } catch (e) {}
      }
      return await fetch(url, {
        cache: 'no-store',
        signal: ctrl.signal,
        headers: headers || {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8'
        },
        redirect: 'follow',
        referrerPolicy: 'no-referrer'
      });
    } finally {
      clearTimeout(t);
      if (signal && extHandler) {
        try { signal.removeEventListener('abort', extHandler); } catch (e) {}
      }
    }
  }

  function abortIpCheckIfAny() {
    if (ipCheckAbort) { try { ipCheckAbort.abort(); } catch (e) {} ipCheckAbort = null; }
  }

  function abortGeoIfAny() {
    if (geoAbort) { try { geoAbort.abort(); } catch (e) {} geoAbort = null; }
  }


  /* =========================================
     9) IP Detection Flows
     ========================================= */
  async function ipCheckServer(totalBudgetMs) {
    const start = nowMs();
    let lastErr = 'timeout';

    while ((nowMs() - start) < totalBudgetMs) {
      try {
        const r = await fetchWithTimeout('server_ip?b=' + Date.now(), IP_PER_ATTEMPT_SERVER, (ipCheckAbort && ipCheckAbort.signal));
        if (!r.ok) throw new Error('HTTP ' + r.status);

        const data = await r.json().catch(function(){ return null; });
        const ip = (data && typeof data.ip === 'string') ? data.ip.trim() : '';
        if (ip && isIPv4(ip)) { lastGoodIp = ip; setIpGeoResolved(ip, ''); return true; }

        lastErr = 'invalid';
      } catch (e) {
        if (e && e.name === 'AbortError') { setIpGeoResolved(null, 'aborted'); return false; }
        lastErr = 'request failed';
      }
      await sleep(400);
    }

    setIpGeoResolved(null, lastErr);
    return false;
  }

  async function ipCheckClientRace(endpoints, totalBudgetMs, perAttemptMs) {
    const startAll = nowMs();
    let lastErr = 'timeout';

    while ((nowMs() - startAll) < totalBudgetMs) {
      const t0 = nowMs();

      const localControllers = endpoints.map(function(){ return new AbortController(); });
      const reqs = endpoints.map(function(ep, idx) {
        const sep = ep.url.indexOf('?') >= 0 ? '&' : '?';
        const url = ep.url + sep + 'r=' + Date.now();
        const headers = { 'Accept': ep.accept };

        const combined = new AbortController();
        const outer = (ipCheckAbort && ipCheckAbort.signal);

        const onOuterAbort = function(){ try { combined.abort(); } catch (e) {} };
        if (outer) {
          if (outer.aborted) try { combined.abort(); } catch (e) {}
          else try { outer.addEventListener('abort', onOuterAbort, { once: true }); } catch (e) {}
        }
        const onLocalAbort = function(){ try { combined.abort(); } catch (e) {} };
        try { localControllers[idx].signal.addEventListener('abort', onLocalAbort, { once: true }); } catch (e) {}

        return fetchWithTimeout(url, perAttemptMs, combined.signal, headers)
          .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            if (ep.type === 'json') return r.json();
            return r.text();
          })
          .then(function(data) {
            let ip = '';
            if (ep.type === 'json') {
              ip = (data && typeof data.ip === 'string') ? data.ip.trim() : '';
            } else {
              ip = (typeof data === 'string') ? data.trim() : '';
            }
            if (!ip || !isIPv4(ip)) throw new Error('ipv4-only');
            return ip;
          })
          .finally(function() {
            if (outer) { try { outer.removeEventListener('abort', onOuterAbort); } catch (e) {} }
          });
      });

      try {
        // Promise.any polyfill-ish: resolve on first fulfilled; if all reject, throw.
        const wrapped = reqs.map(p => p.then(v => ({ok:true,v}), e => ({ok:false,e})));
        const results = await Promise.all(wrapped);
        let winner = null;
        for (let i=0;i<results.length;i++){ if (results[i].ok) { winner = results[i].v; break; } }
        if (winner != null) {
          for (const c of localControllers) { try { c.abort(); } catch (e) {} }

          const elapsed = nowMs() - t0;
          const suspect = (elapsed < SUSPECT_FAST_MS) && (lastGoodIp && winner === lastGoodIp);
          if (!suspect) { lastGoodIp = winner; setIpGeoResolved(winner, ''); return true; }
        } else {
          lastErr = 'request failed';
        }
      } catch (e) {
        lastErr = (e && e.message) || 'request failed';
      }

      await sleep(800);
    }

    setIpGeoResolved(null, lastErr);
    return false;
  }

    async function runIpPhase(mode) {
    ensureIpGeoLayout();
    abortGeoIfAny();
    abortIpCheckIfAny();

    ipCheckAbort = new AbortController();
    setIpChecking();

    try {
      if (mode === 'pageload') {
        const status = await refreshSvcStatus();
        const torOn = !!(status && status.torproxy);

        if (torOn) {
          const okClient = await ipCheckClientRace(
            PAGELOAD_TOR_ENDPOINTS,
            IP_TOTAL_PAGELOAD_CLIENT_MS,
            IP_PER_ATTEMPT_PAGELOAD_CLIENT
          );
          if (okClient) return true;
          await ipCheckServer(IP_TOTAL_SERVER_MS);
          return;
        } else {
          await ipCheckServer(IP_TOTAL_SERVER_MS);
          return;
        }
      }

      if (mode === 'tor_up') {
        await sleep(IP_GRACE_TOR_MS);
        await ipCheckClientRace(TOR_UP_ENDPOINTS, IP_TOTAL_TOR_MS, IP_PER_ATTEMPT_TOR);
        return;
      }

      if (mode === 'wg_up') {
        await sleep(IP_GRACE_WG_MS);
        await ipCheckServer(IP_TOTAL_SERVER_MS);
        return;
      }

      if (mode === 'clearnet') {
        await sleep(IP_GRACE_WG_MS);
        await ipCheckServer(IP_TOTAL_SERVER_MS);
        return;
      }
    } finally {
      abortIpCheckIfAny();
    }
  }


  /* =========================================
     10) Geolocation
     ========================================= */
  function renderGeoCheckingWithIp(ip) {
    const gl = $('geo-line');
    if (!gl) return;
    gl.style.color = 'red';
    stopSpinner('geo-spinner', false);
    gl.innerHTML = 'Checking IP <b>' + escapeHtml(ip) + '</b>: <span id="geo-spinner"></span>';
    startArrowSpinner('geo-spinner');
  }

  function renderGeoError(msg) {
    const gl = $('geo-line');
    if (!gl) return;
    stopSpinner('geo-spinner', false);
    gl.style.color = 'red';
    gl.textContent = 'Geolocation: ' + msg;
  }

  function renderGeoResult(ip, data, err) {
    const gl = $('geo-line');
    if (!gl) return;
    stopSpinner('geo-spinner', false);
    gl.style.color = 'red';

    if (err) {
      gl.innerHTML = 'Geolocation: <b>Unavailable (' + escapeHtml(err) + ')</b>';
      return;
    }
    if (ip !== lastGoodIp) {
      gl.textContent = 'Geolocation: (stale)';
      return;
    }

    const city = (data && data.city) || '';
       const region = (data && data.region) || '';
    const country = (data && data.country) || '';
    const org = (data && (data.org || data.asn)) || '';

    const parts = [];
    parts.push('Geolocation: <b>');
    parts.push(city ? escapeHtml(city) : 'Unknown');
    const tail = [region, country].filter(Boolean).map(escapeHtml).join(', ');
    if (tail) parts.push(', ' + tail);
    if (org) parts.push(' — ' + escapeHtml(org));
    parts.push('</b>');

    gl.innerHTML = parts.join('');
  }

  async function requestServerGeo(ip) {
    if (!ip || !isIPv4(ip)) return;

    abortGeoIfAny();
    geoAbort = new AbortController();

    renderGeoCheckingWithIp(ip);

    try {
      const url = 'server_geo?ip=' + encodeURIComponent(ip) + '&b=' + Date.now();
      const r = await fetchWithTimeout(url, 14000, geoAbort.signal);
      const data = await r.json().catch(function(){ return null; });

      if (!r.ok) {
        const msg = (data && (data.error || data.message)) || ('HTTP ' + r.status);
        renderGeoResult(ip, null, 'unavailable (' + msg + ')');
        return;
      }
      renderGeoResult(ip, data, null);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        // Swallow aborts during transitions (tor/wg toggles, wifi changes).
        // The subsequent runIpPhase() will repaint with fresh IP/Geo.
        return;
      }
      renderGeoResult(ip, null, 'unavailable (request failed)');
    }
  }


  /* =========================================
     11) Auto-connect helper (WireGuard)
     ========================================= */
  async function ensureWgAutoConnect(prefetchedState) {
    const s = prefetchedState || await refreshSvcStatus();
    if (!s) return false;
    const isWifiUp = !!(s.ssid_connect);
    const shouldAuto = !!(s.wireguard_configured && s.wireguard_autoconnect && !s.torproxy && !s.wireguard && isWifiUp);
    if (shouldAuto) {
      await svcCall('wg', 'wg/up', 'wg-state');
      return true;
    }
    return false;
  }


  /* =========================================
     12) Wi-Fi Connect / Disconnect
     ========================================= */
  async function submitConnect(ev) {
    ev.preventDefault();

    const btn = $('btn-connect');
       const current = $('current-ssid');
    const form = $('wifi-form');
    const pwInput = $('password');
    if (!btn || !current || !form || !pwInput) return;

    cancelScanIfAny();

    // Show spinner in "Current Network" while connecting
    startTextSpinner('current-ssid');

    let autoPausedThisTime = false;
    if (!pausedByUser) {
      autoPausedUntil = nowMs() + 20000;
      paused = true;
      autoPausedThisTime = true;
    }

    try {
      btn.disabled = true;

      const resp = await fetch('submit', { method: 'POST', body: new FormData(form) });
      if (!resp.ok) {
        // Stop spinner then fallback to server status
        stopSpinner('current-ssid', false);
        try {
          const st = await (await fetch('status?b=' + nowMs(), { cache: 'no-store' })).json();
          if (st && ('ssid_connect' in st)) current.textContent = st.ssid_connect || 'disconnected';
        } catch (e) {}
        removeAllConnectedLabels();
        return;
      }

      const sel = $('ssid');
      const chosen = (sel && sel.value) || '';

      // Stop spinner and set the freshly chosen SSID
      stopSpinner('current-ssid', false);
      current.textContent = chosen || 'connected';
      updateConnectedLabel(chosen);
      pwInput.value = '';

      // Hide offline looping banner once connected
      updateOfflineNotice(false);

      // === refresh IP & Geo after connect ===
      ensureIpGeoLayout();
      abortGeoIfAny();
      abortIpCheckIfAny();
      const s = await refreshSvcStatus();

      // Re-enable Disconnect when connected
      const discBtn = $('btn-disconnect');
      if (discBtn) discBtn.disabled = false;

      // Autoconnect decision on Wi-Fi connect (requires Wi-Fi up)
      const didAuto = await ensureWgAutoConnect(s);
      if (!didAuto) {
        if (s && s.torproxy) {
          await runIpPhase('tor_up');
        } else if (s && s.wireguard) {
          await runIpPhase('wg_up');
        } else {
          await runIpPhase('clearnet');
        }
        // brief poll to reflect WG autoconnect coming back after Wi-Fi connect
        await pollWgReconnect(20000);
      }

      // reset remembered flags
      torWasOnAtDisconnect = false;
      wgAutoAtDisconnect = false;

      if (!pausedByUser && autoPausedThisTime) { autoPausedUntil = 0; paused = false; }
      if (!paused) scheduleNextScan(SCAN_INTERVAL_MS);
      refreshStatusLine();
    } finally {
      if (btn) btn.disabled = false;
    }
  }


  async function doDisconnect() {
    const btn = $('btn-disconnect');
    const current = $('current-ssid');
    if (!btn || !current) return;

    cancelScanIfAny();

    // Show spinner in "Current Network" while disconnecting
    startTextSpinner('current-ssid');

    // While disconnecting, show IP/Geo spinners (no checks will be triggered)
    ensureIpGeoLayout();
    setIpChecking();

    // Immediately disable WG/Tor buttons since we're going offline
    const wgBtnImmed = $('btn-wg-toggle');
    const torBtnImmed = $('btn-tor-toggle');
    if (wgBtnImmed) wgBtnImmed.disabled = true;
    if (torBtnImmed) torBtnImmed.disabled = true;

    try {
      btn.disabled = true;

      // Snapshot current service state at the moment of disconnect
      const sBefore = await refreshSvcStatus();
      torWasOnAtDisconnect = !!(sBefore && sBefore.torproxy);
      wgAutoAtDisconnect   = !!(sBefore && (sBefore.wireguard_configured && sBefore.wireguard_autoconnect));

      // First disconnect Wi-Fi
      const resp = await fetch('disconnect', { method: 'POST', cache: 'no-store' });
      if (!resp.ok) throw new Error('disconnect failed');

      // Ensure TorProxy is disconnected (but suppress any IP/Geo flows)
      await svcCall('tor', 'tor/down', 'tor-state', { method: 'POST', _suppressIpGeo: true });

      // Bring WireGuard down BUT keep autoconnect; suppress IP/Geo and do it fast
      await svcCall('wg', 'wg/down_keep_auto', 'wg-state', { method: 'POST', _fast: true, _suppressIpGeo: true });

      // Stop spinner and set text
      stopSpinner('current-ssid', false);
      current.textContent = 'disconnected';
      removeAllConnectedLabels();

      // Show offline looping banner while disconnected
      updateOfflineNotice(true);

      // Immediately show final IP/Geo "Unavailable" states with no further checks
      setIpGeoResolved(null, 'disconnected');

      if (!pausedByUser) { autoPausedUntil = 0; paused = false; }
      if (!paused) scheduleNextScan(SCAN_INTERVAL_MS);
      refreshStatusLine();
    } catch (e) {
      // On error, stop spinner and leave whatever text was there
      stopSpinner('current-ssid', true);
    } finally {
      // Keep Disconnect disabled while disconnected; it will be re-enabled on next connect
      btn.disabled = !wifiConnected;
    }
  }


  /* =========================================
     13) Scan Pause/Resume
     ========================================= */
  function setPaused(p) {
    const was = paused;
    paused = p;

    const toggleBtn = $('btn-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = paused ? 'Resume Background Scans' : 'Pause Background Scans';
    }

    nextScanAt = paused ? 0 : (nowMs() + SCAN_INTERVAL_MS);
    if (!was && paused) autoPausedUntil = 0;
    refreshStatusLine();
  }

  function togglePause() {
    pausedByUser = true;
    autoPausedUntil = 0;
    setPaused(!paused);
  }


  /* =========================================
     14) Service Controls (WG / Tor / Hotspot)
     ========================================= */
  function setSvcButtonsFromState() {
    const hotBtn = $('btn-hotspot-toggle');
    const wgBtn  = $('btn-wg-toggle');
    const torBtn = $('btn-tor-toggle');

    if (!hotspotUiLock) {
      if (hotBtn) hotBtn.textContent = svcState.hotspot ? 'Hotspot: Deactivate' : 'Hotspot: Activate';
      if (!_spinTimers['hotspot-state']) {
        const hs = $('hotspot-state'); if (hs) hs.textContent = svcState.hotspot ? 'active' : 'inactive';
      }
    }
    if (wgBtn)  wgBtn.textContent  = svcState.wireguard ? 'WireGuard: Disconnect' : 'WireGuard: Connect';
    if (torBtn) torBtn.textContent = svcState.torproxy  ? 'TorProxy: Disconnect'  : 'TorProxy: Connect';
  }

  function enforceConnectivityButtons() {
    if (svcButtonsLocked) return; // don't fight during active service ops
    const wgBtn = $('btn-wg-toggle');
    const torBtn = $('btn-tor-toggle');
    const discBtn = $('btn-disconnect');            // <-- manage Disconnect button too
    if (wgBtn) wgBtn.disabled = !wifiConnected;
    if (torBtn) torBtn.disabled = !wifiConnected;
    if (discBtn) discBtn.disabled = !wifiConnected; // disable when no Wi-Fi
  }
  
    // --- Tor notice reveal/fade helper ---
  function updateTorNotice(connected) {
    const card = $('tor-ascii-card');
    if (!card) return;

    if (connected) {
      // ensure it's mountable for transition
      if (card.hasAttribute('hidden')) card.removeAttribute('hidden');
      // reflow to let the class transition animate
      void card.offsetWidth; 
      card.classList.add('is-visible');
    } else {
      // start fade out
      card.classList.remove('is-visible');
      // after the fade completes, hide it to keep layout clean
      setTimeout(() => {
        if (!card.classList.contains('is-visible')) {
          card.setAttribute('hidden', '');
        }
      }, 200); // a hair longer than the CSS 180ms
    }
  }
  
  // --- Unified WireGuard status string ---
  function wgStatusString(cfg, connected, autoconnect) {
    if (!cfg) return 'not configured';
    const base = connected ? 'connected' : 'disconnected';
    return autoconnect ? (base + ' (auto-connect)') : base;
  }

  // --- Offline notice (ASCII) loop helper ---
  // Idempotent. Smooth fade-in from 0%. On hide, always run a visible fade to 0,
  // then hide only after the transition completes (with a safety timer fallback).
  function updateOfflineNotice(show) {
    const card = $('offline-ascii-card');
    if (!card) return;

    // Clean prior transitionend / timers
    if (card._offlineTe) {
      try { card.removeEventListener('transitionend', card._offlineTe); } catch (_) {}
      card._offlineTe = null;
    }
    if (card._offlineTimer) {
      clearTimeout(card._offlineTimer);
      card._offlineTimer = null;
    }

    if (show) {
      // If already visible and looping, do nothing (prevents restarts/jitter)
      if (!card.hasAttribute('hidden') && card.classList.contains('is-looping')) return;

      // Cancel any ongoing fade-out state
      delete card.dataset.fadingOut;

      // Mount and start from opacity 0 (no transition while the pulse runs)
      if (card.hasAttribute('hidden')) card.removeAttribute('hidden');
      card.classList.add('no-transition');
      card.classList.remove('is-looping');
      card.style.animation = 'none';
      card.style.opacity = '0';
      void card.offsetWidth;            // commit start state

      // Start loop exactly once at keyframe 0
      card.classList.add('is-looping');
      card.style.animation = '';        // let CSS rule control the animation
      return;
    }

    // HIDE path: skip if already hidden or mid-fade-out
    if (card.hasAttribute('hidden') || card.dataset.fadingOut === '1') return;
    card.dataset.fadingOut = '1';

    // Freeze current frame and re-enable transition for smooth fade-out
    const EPS = 0.03; // small bump so transition always fires, yet visually imperceptible
    let cur = parseFloat(window.getComputedStyle(card).opacity || '0');

    card.classList.remove('is-looping');
    card.classList.remove('no-transition'); // re-enable base opacity transition
    card.style.animation = 'none';

    // Ensure we have a start value > 0 so opacity actually transitions to 0
    if (!isFinite(cur) || cur <= EPS) {
      card.style.opacity = String(EPS);    // bump up slightly
      void card.offsetWidth;               // lock start at EPS
    } else {
      card.style.opacity = String(cur);    // lock real current value
      void card.offsetWidth;
    }

    const onEnd = function (ev) {
      if (ev && ev.propertyName !== 'opacity') return;
      cleanup();
    };
    card._offlineTe = onEnd;
    card.addEventListener('transitionend', onEnd);

    // Safety: if transitionend doesn't arrive (tab switch, compositor drop), hide anyway
    card._offlineTimer = setTimeout(() => { cleanup(); }, 700); // > 180ms transition

    // Kick the fade to 0 on the next frame
    requestAnimationFrame(() => { card.style.opacity = '0'; });

    function cleanup() {
      if (!card) return;
      if (card._offlineTe) {
        try { card.removeEventListener('transitionend', card._offlineTe); } catch (_) {}
        card._offlineTe = null;
      }
      if (card._offlineTimer) {
        clearTimeout(card._offlineTimer);
        card._offlineTimer = null;
      }
      card.setAttribute('hidden', '');
      card.style.animation = '';
      card.style.opacity = '';
      delete card.dataset.fadingOut;
    }
  }

  function applySvcStatusToDom(payload) {
    const current = $('current-ssid');
    // Do not overwrite "Current Network" while its spinner is active
    if (current && !_spinTimers['current-ssid'] && payload && ('ssid_connect' in payload)) {
      current.textContent = payload.ssid_connect || 'disconnected';
    }

    wifiConnected = !!(payload && payload.ssid_connect);

    svcState = {
      hotspot:  !!(payload && payload.hotspot),
      wireguard:!!(payload && payload.wireguard),
      torproxy: !!(payload && payload.torproxy),
      wg_configured: !!(payload && payload.wireguard_configured),
      wg_autoconnect: !!(payload && payload.wireguard_autoconnect)
    };

    // --- Toggle offline ASCII loop based on Wi-Fi connectivity ---
    if (wifiConnected) updateOfflineNotice(false);
    else               updateOfflineNotice(true);

    // Update unified WireGuard status message (spinner will override this when active)
    if (!_spinTimers['wg-state'])  {
      const el = $('wg-state');
      if (el) {
        el.textContent = wgStatusString(
          svcState.wg_configured,
          svcState.wireguard,
          svcState.wg_autoconnect
        );
      }
    }
    // Ensure the old / Autoconnect tag area stays empty (we now show it inline)
    (function(){
      const autoEl = $('wg-auto');
      if (autoEl) autoEl.innerHTML = '';
    })();

    if (!_spinTimers['tor-state']) {
      const el2 = $('tor-state');
      if (el2) el2.textContent = svcState.torproxy  ? 'connected' : 'disconnected';
    }

    // Show/hide Tor notice immediately based on current state
    if (svcState.torproxy) updateTorNotice(true);
    else                   updateTorNotice(false);

    setSvcButtonsFromState();
    enforceConnectivityButtons(); // includes Disconnect button now
  }

  async function refreshSvcStatus() {
    try {
      const resp = await fetch('svc_status?b=' + nowMs(), { cache: 'no-store' });
      const data = await resp.json().catch(function(){ return {}; });
      applySvcStatusToDom(data || {});
      return data || {};
    } catch (e) {
      return {};
    }
  }

  function disableSvcButtons(disabled) {
    ['btn-hotspot-toggle', 'btn-wg-toggle', 'btn-tor-toggle']
      .forEach(function(id) { const el = $(id); if (el) el.disabled = disabled; });
  }

  async function waitForSvcStable(target, timeoutMs) {
    let stableHits = 0;
    const t0 = nowMs();

    while ((nowMs() - t0) < timeoutMs) {
      const s = await refreshSvcStatus();
      const wantWG  = (typeof target.wireguard === 'boolean') ? target.wireguard : s.wireguard;
      const wantTor = (typeof target.torproxy  === 'boolean') ? target.torproxy  : s.torproxy;
      const wantHot = (typeof target.hotspot   === 'boolean') ? target.hotspot   : s.hotspot;

      const ok = (s.wireguard === wantWG) && (s.torproxy === wantTor) && (s.hotspot === wantHot);
      if (ok) { stableHits += 1; if (stableHits >= 2) return { stable: true, state: s }; }
      else { stableHits = 0; }

      await sleep(SVC_STABLE_POLL_MS);
    }
    return { stable: false, state: await refreshSvcStatus() };
  }

  function setWgUiFinal(state) {
    stopSpinner('wg-state', false);
    const st = $('wg-state');
    if (st) {
      const cfg = !!(state && (state.wireguard_configured || state.wg_configured));
      const connected = !!(state && state.wireguard);
      // Prefer explicit autoconnect from state; fall back to our cached svcState if missing
      const auto = (state && (state.wireguard_autoconnect === true))
        ? true
        : (!!(svcState && svcState.wg_autoconnect));
      st.textContent = wgStatusString(cfg, connected, auto);
    }
    const bt = $('btn-wg-toggle'); if (bt) bt.textContent = (state && state.wireguard) ? 'WireGuard: Disconnect' : 'WireGuard: Connect';

    // Ensure legacy wg-auto tag stays empty
    const autoEl = $('wg-auto');
    if (autoEl) autoEl.innerHTML = '';
  }

  function setTorUiFinal(state) {
    stopSpinner('tor-state', false);
    const st = $('tor-state'); if (st) st.textContent = (state && state.torproxy) ? 'connected' : 'disconnected';
    const bt = $('btn-tor-toggle'); if (bt) bt.textContent = (state && state.torproxy) ? 'TorProxy: Disconnect' : 'TorProxy: Connect';

    // Show/hide immediately
    if (state && state.torproxy) {
      updateTorNotice(true);
    } else {
      updateTorNotice(false);
    }
  }

  async function svcCall(kind, path, stateElId, reqInitOverride) {
    const isWg = (kind === 'wg');
    const isTor = (kind === 'tor');
    const isHotspot = (kind === 'hotspot');

    const prevPaused = paused;
    if (isWg || isTor) setPaused(true);

    try {
      svcButtonsLocked = true; // lock buttons during ops so status refresh won't re-enable them
      disableSvcButtons(true);

      if (isHotspot) { hotspotUiLock = true; startTextSpinner('hotspot-state'); }
      else {
        // Start spinner on the entire status field
        startTextSpinner(stateElId);
        // Hide legacy wg-auto tag during ops so spinner represents whole status
        if (isWg) {
          const autoEl = $('wg-auto');
          if (autoEl) autoEl.innerHTML = '';
        }
      }

      const baseInit = { method: 'POST', cache: 'no-store' };
      const init = Object.assign({}, baseInit, (reqInitOverride || {}));
      const suppressIpGeo = !!init._suppressIpGeo;

      const resp = await fetch(path, init);
      const ok = resp.ok;
      const body = await resp.json().catch(function(){ return {}; });

      // WG not configured: show immediately and bail (no waiting)
      if (isWg && (!ok || body.configured === false)) {
        // Also reflect state in svcState
        svcState.wireguard = false;
        setWgUiFinal({ wireguard: false, wireguard_configured: false, wireguard_autoconnect: false });
        return false;
      }

      // Fast-path: when asked (_fast) for wg/down_keep_auto as part of Wi-Fi disconnect
      if (isWg && init && init._fast && path === 'wg/down_keep_auto') {
        svcState.wireguard = false;
        // keep autoconnect state as-is; fetch to refresh UI including unified status
        try {
          const s = await refreshSvcStatus();
          setWgUiFinal(s);
        } catch (e) {
          setWgUiFinal({ wireguard: false, wireguard_configured: (body && (body.configured !== false)), wireguard_autoconnect: svcState.wg_autoconnect });
        }
        return ok;
      }

      const want = {
        wireguard: path.indexOf('wg/') === 0      ? path.slice(-2) === 'up'  : null,
        torproxy:  path.indexOf('tor/') === 0     ? path.slice(-2) === 'up'  : null,
        hotspot:   path.indexOf('hotspot/') === 0 ? path.slice(-2) === 'up'  : null,
      };

      let result = await waitForSvcStable(want, SVC_STABLE_TIMEOUT_MS);
      if (!result.stable && (isWg || isTor)) {
        result = await waitForSvcStable(want, SVC_STABLE_SECOND_CHANCE_MS);
      }

      if (isHotspot) {
        const s = result.state || await refreshSvcStatus();
        stopSpinner('hotspot-state', false);
        const hs = $('hotspot-state'); if (hs) hs.textContent = s.hotspot ? 'active' : 'inactive';
        const bt = $('btn-hotspot-toggle'); if (bt) bt.textContent = s.hotspot ? 'Hotspot: Deactivate' : 'Hotspot: Activate';
        hotspotUiLock = false;

        await refreshHotspotInfo();
        await updateHotspotClients();
        refreshHotspotQR();
      } else if (isWg) {
        const s = result.state || await refreshSvcStatus();
        setWgUiFinal(s);
      } else if (isTor) {
        const s = result.state || await refreshSvcStatus();
        setTorUiFinal(s);
      }

      // IP/Geo phases and autoconnect enforcement (skip entirely if suppressed)
      if (!suppressIpGeo) {
        if (isTor && want.torproxy === true) {
          // Mutual exclusion: Tor up -> go to tor IP flow; WG stays down regardless of autoconnect
          abortGeoIfAny(); 
          abortIpCheckIfAny();
          await runIpPhase('tor_up');
        } else if (isTor && want.torproxy === false) {
          // Tor down -> if autoconnect enabled and Wi-Fi up, bring WG up automatically
          const s = (result && result.state) || await refreshSvcStatus();

          // IMPORTANT: abort before WG autoconnect, so we don't kill the WG-up phase it starts
          abortGeoIfAny(); 
          abortIpCheckIfAny();

          const didAuto = await ensureWgAutoConnect(s);

          if (!didAuto) {
            await runIpPhase('clearnet');
          }
        } else if (isWg) {
          abortGeoIfAny(); 
          abortIpCheckIfAny();
          if (want.wireguard === true) {
            await runIpPhase('wg_up');
          } else {
            // wg down (manual): clearnet
            await runIpPhase('clearnet');
          }
        }
      }


      return ok;
    } catch (e) {
      if (isHotspot) { hotspotUiLock = false; stopSpinner('hotspot-state', true); }
      else { stopSpinner(stateElId, true); }
      setIpGeoResolved(null, 'unexpected error');
      return false;
    } finally {
      if (!isHotspot) stopSpinner(stateElId, true);
      const latest = await refreshSvcStatus();
      disableSvcButtons(false);
      svcButtonsLocked = false; // unlock UI
      enforceConnectivityButtons(); // re-apply Wi-Fi connectivity rule (incl. Disconnect)
      if (isWg || isTor) setPaused(prevPaused);
      refreshStatusLine();
    }
  }

  // Brief poll to reflect WG autoconnect coming back after Wi-Fi connect
  async function pollWgReconnect(maxMs = 20000) {
    const start = nowMs();
    while ((nowMs() - start) < maxMs) {
      const s = await refreshSvcStatus();
      if (s && s.wireguard) {
        setWgUiFinal(s);
        return true;
      }
      await sleep(800);
    }
    return false;
  }

  // --- Hotspot helpers ---
  async function refreshHotspotInfo() {
    try {
      const r = await fetch('hotspot/info?b=' + nowMs(), { cache: 'no-store' });
      if (!r.ok) return;
      const info = await r.json().catch(function(){ return {}; });
      const input = $('hotspot-ssid');
      if (input) {
        const ssid = (info && info.ssid) || '';
        const sec  = (info && info.security === 'WPA3') ? 'WPA3' : ((info && info.security === 'WPA2') ? 'WPA2' : '');
        const isActive = svcState.hotspot === true;

        let val = ssid || '';
        if (ssid) {
          const statusTag = isActive ? '(active)' : '(inactive)';
          const secSuffix = sec ? (' — ' + sec) : '';
          val = ssid + ' ' + statusTag + secSuffix;
        }
        input.value = val;
      }
    } catch (e) {}
  }

  async function updateHotspotClients() {
    const countEl = $('hotspot-clients-count');
    if (!countEl) return;

    if (!svcState.hotspot) {
      lastClientsCount = 0;
      countEl.textContent = '0';
      return;
    }

    try {
      const r = await fetch('hotspot/clients?b=' + nowMs(), { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json().catch(function(){ return {}; });
      let count = Number((data && data.count) || 0);
      if (!Number.isFinite(count) || count < 0) count = 0;

      if (count !== lastClientsCount) {
        lastClientsCount = count;
        countEl.textContent = String(count);
      }
    } catch (e) {
      // ignore
    }
  }

  function refreshHotspotQR() {
    const img = $('hotspot-qr');
    if (!img) return;
    img.src = 'hotspot/qr.svg?c=' + (qrHover ? 'green' : 'red') + '&b=' + Date.now();
  }

  // Hotspot button (Activate/Deactivate) & config
  async function toggleHotspotButton(ev) {
    if (ev) ev.preventDefault();

    const ssidEl = $('hotspot-ssid');
    const pwEl   = $('hotspot-password');

    const rawSsid = (ssidEl && ssidEl.value) || '';
    const cleanedSsid = rawSsid
      .replace(/\s*—\s*(WPA2|WPA3)\s*$/i, '')
      .replace(/\s*\(active\)\s*$/i, '')
      .replace(/\s*\(inactive\)\s*$/i, '')
      .trim();

    const newPw = (pwEl && pwEl.value) || '';
    const hasSsid = cleanedSsid.length > 0;
    const hasPw   = newPw.length > 0;

    if (svcState.hotspot) {
      await svcCall('hotspot', 'hotspot/down', 'hotspot-state');

      if (hasSsid || hasPw) {
        const fd = new FormData();
        if (hasSsid) fd.append('ssid', cleanedSsid);
        if (hasPw)   fd.append('password', newPw);
        try { await fetch('hotspot/config', { method: 'POST', body: fd, cache: 'no-store' }); } catch (e) {}
      }
    } else {
      const fd = new FormData();
      if (hasSsid) fd.append('ssid', cleanedSsid);
      if (hasPw)   fd.append('password', newPw);
      await svcCall('hotspot', 'hotspot/up', 'hotspot-state', { method: 'POST', body: fd });
    }

    if (pwEl) pwEl.value = '';

    await refreshSvcStatus();
    await refreshHotspotInfo();
    await updateHotspotClients();
    refreshHotspotQR();
  }

  async function toggleWG() {
    const path = svcState.wireguard ? 'wg/down' : 'wg/up';
    await svcCall('wg', path, 'wg-state');
  }

  async function toggleTor() {
    const path = svcState.torproxy ? 'tor/down' : 'tor/up';
    await svcCall('tor', path, 'tor-state');
  }


  /* =========================================
     15) Ticker & Connected Labels
     ========================================= */
  function tick() {
    const n = nowMs();
    if (autoPausedUntil && n >= autoPausedUntil && !pausedByUser) {
      autoPausedUntil = 0;
      paused = false;
    }
    if (!paused && !inFlight && nextScanAt && n >= nextScanAt) {
      triggerBackgroundScan();
    }
    refreshStatusLine();
  }

  function removeAllConnectedLabels() {
    const sel = $('ssid'); if (!sel) return;
    for (let i = 0; i < sel.options.length; i++) {
      sel.options[i].textContent = stripConnectedTag(sel.options[i].textContent || '');
    }
  }

  function updateConnectedLabel(ssid) {
    const sel = $('ssid'); if (!sel) return;
    for (let i = 0; i < sel.options.length; i++) {
      const opt = sel.options[i];
      const base = stripConnectedTag(opt.textContent || '');
      opt.textContent = (opt.value === ssid) ? (base + ' (connected)') : base;
    }
  }

  /* =========================================
     16) Hotspot Clients Polling (FIX)
     ========================================= */
  function startClientsPolling() {
    if (clientsTimer) { try { clearInterval(clientsTimer); } catch (e) {} }
    clientsTimer = setInterval(updateHotspotClients, HOTSPOT_CLIENTS_POLL_MS);
  }

  /* =========================================
     17) Bootstrapping
     ========================================= */
  document.addEventListener('DOMContentLoaded', function () {
    // 1) Attach all listeners FIRST so UI keeps working even if init fetches fail
    var el;

    el = $('btn-toggle');        if (el) el.addEventListener('click', togglePause);
    el = $('wifi-form');         if (el) el.addEventListener('submit', submitConnect);
    el = $('btn-disconnect');    if (el) el.addEventListener('click', doDisconnect);
    el = $('btn-hotspot-toggle');if (el) el.addEventListener('click', toggleHotspotButton);
    el = $('hotspot-form');      if (el) el.addEventListener('submit', toggleHotspotButton);
    el = $('btn-wg-toggle');     if (el) el.addEventListener('click', toggleWG);
    el = $('btn-tor-toggle');    if (el) el.addEventListener('click', toggleTor);

    const qr = $('hotspot-qr');
    if (qr) {
      qr.style.cursor = 'pointer';
      qr.addEventListener('mouseenter', function(){ qrHover = true;  refreshHotspotQR(); });
      qr.addEventListener('mouseleave', function(){ qrHover = false; refreshHotspotQR(); });
      qr.addEventListener('click', function(e){ toggleHotspotButton(e); });
    }

    // 2) Then kick off async init (non-blocking for the UI)
    paused = false;
    pausedByUser = false;
    autoPausedUntil = 0;
    lastNetCount = null;

    (async function init() {
      try { await refreshSvcStatus(); } catch (e) {}
      try { await refreshHotspotInfo(); } catch (e) {}
      try { await updateHotspotClients(); } catch (e) {}
      startClientsPolling();

      refreshHotspotQR();
      setupPasswordToggles(['password', 'hotspot-password']);

      triggerBackgroundScan(true);
      setInterval(tick, 250);
      refreshStatusLine();

      // ensure IP/Geo placeholders exist before spinner
      ensureIpGeoLayout();
      setIpChecking();
      try { await runIpPhase('pageload'); } catch (e) {}

      // --- reflect current connectivity with offline banner on first paint ---
      updateOfflineNotice(!wifiConnected);
    })();
  });


  /* =========================================
     18) Password Visibility Toggles (eye)
     ========================================= */
  function makePwToggle(input) {
    if (!input || (input.dataset && input.dataset.eyeApplied)) return;

    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    input.classList.add('with-eye');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('title', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.dataset.visible = 'false';

    btn.addEventListener('mousedown', function(e){ e.preventDefault(); });

    btn.addEventListener('click', function () {
      const nowVisible = input.type === 'password';
      input.type = nowVisible ? 'text' : 'password';
      btn.dataset.visible = String(nowVisible);
      btn.setAttribute('aria-pressed', String(nowVisible));
      btn.setAttribute('aria-label', nowVisible ? 'Hide password' : 'Show password');
      btn.setAttribute('title', nowVisible ? 'Hide password' : 'Show password');
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    });

    wrap.appendChild(btn);
    if (input.dataset) input.dataset.eyeApplied = '1';
  }

  function setupPasswordToggles(ids) {
    (ids || []).forEach(function(id) {
      const el = document.getElementById(id);
      if (el) makePwToggle(el);
    });
  }

})();
