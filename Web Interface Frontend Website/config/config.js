/*
config.js — Frontend controller for the Device Configuration panel.

What it does:

- Paints a live, two-column “config” panel: static MOTD header/footer + dynamic stats.
- Syncs the client-side clock to server time and drives an analog canvas clock.
- Periodically refreshes system stats (load, memory, swap, processes, temperature).
- Fetches and displays the active NTP peer (hostname + IP) with graceful fallbacks.
- Intercepts power actions (shutdown/reboot) to avoid navigation and coordinate a dim/undim UX.
- Plays nicely with power.js on the main site: config.js sends `postMessage` hints so power.js
  can instantly fade out the main page during shutdown/reboot, while health polling fades it in 
  when back.

Section map:

1) Overview & Guards — External script requirement, base path detection.
2) Utility Formatters — Tiny helpers for date/uptime rendering and TZ abbreviation.
3) DOM Handles — One-time element lookups for dynamic fields.
4) Server Time Baseline — Sync Pi time to drive the client clock with steady ticks.
5) Stat Refresh Loop — Lightweight periodic /stats polling with retry scheduling.
6) Analog Clock — Canvas setup, resize, face/marks, and hand drawing on server time.
7) NTP Peer Fetch — Read-only /ntp JSON to show hostname and IP (pool can rotate).
8) Power Actions Intercept — Submit POSTs via fetch; send `postMessage` to parent (power.js).
9) Boot Sequence — Initial sync/paint, timers, observers, and periodic refresh wiring.
*/

/* =========================================
   1) Overview & Guards
   - External JS only (CSP-safe), no inline code.
   - All fetches use same-origin and no-store caching.
   ========================================= */

// External JS only (no inline), CSP-safe.
document.addEventListener('DOMContentLoaded', () => {
  // ----- MOTD live-updating -----
  // Base path detection so the same file works at "/" or "/config/"
  const base = location.pathname.startsWith('/config/') ? '/config/' : '/';

  /* =========================================
     2) Utility Formatters
     - Linux-like date string for the MOTD row
     - HH:MM:SS uptime formatting
     - Local timezone abbreviation (fallback to UTC)
     ========================================= */

  // --- Utility formatters ---
  const pad2 = n => String(n).padStart(2, '0');
  function fmtDateLikeLinux(d, tzAbbr) {
    const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${WD[d.getDay()]} ${MN[d.getMonth()]} ${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${tzAbbr} ${d.getFullYear()}`;
  }
  function fmtUptimeHMS(total) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }
  function localTzAbbr() {
    try {
      const s = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' });
      const m = s.match(/\b([A-Z]{2,5})\b/);
      return m ? m[1] : 'UTC';
    } catch { return 'UTC'; }
  }

  /* =========================================
     3) DOM Handles
     - Cache references to dynamic spans once.
     ========================================= */

  // --- Grab value spans once ---
  const el = id => document.getElementById(id);
  const siDate   = el('si-date');
  const vLoad    = el('stat-load');
  const vMem     = el('stat-mem');
  const vProcs   = el('stat-procs');
  const vSwap    = el('stat-swap');
  const vTemp    = el('stat-temp');
  const vUptime  = el('stat-uptime');

  /* =========================================
     4) Server Time Baseline
     - Pull epoch/uptime/TZ from backend once per minute.
     - Compute "now" and "uptime" from a monotonic drift.
     ========================================= */

  // --- Baselines from server for exact ticking ---
  let baseEpochMs = null;
  let baseUptime  = null;
  let clientSyncMs = null;
  let tzAbbr = null;

  async function syncTime() {
    const r = await fetch(base + 'time', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error('time HTTP ' + r.status);
    const j = await r.json();
    baseEpochMs = j.epoch * 1000;
    baseUptime  = j.uptime;
    tzAbbr      = j.tz || localTzAbbr();
    clientSyncMs = Date.now();
  }

  function nowFromBaseline() {
    if (baseEpochMs == null || clientSyncMs == null) return new Date();
    const drift = Date.now() - clientSyncMs;
    return new Date(baseEpochMs + drift);
  }

  function uptimeFromBaseline() {
    if (baseUptime == null || clientSyncMs == null) return 0;
    const drift = Date.now() - clientSyncMs;
    return Math.max(0, baseUptime + Math.floor(drift / 1000));
  }

  function renderTick() {
    if (siDate) siDate.textContent = fmtDateLikeLinux(nowFromBaseline(), tzAbbr || localTzAbbr());
    if (vUptime) vUptime.textContent = fmtUptimeHMS(uptimeFromBaseline());
  }

  /* =========================================
     5) Stat Refresh Loop
     - Fetch /stats every ~10s and paint values.
     - Errors are logged; loop reschedules itself.
     ========================================= */

  async function refreshStats() {
    try {
      const r = await fetch(base + 'stats', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error('stats HTTP ' + r.status);
      const s = await r.json();

      if (vLoad)   vLoad.textContent   = s.load;
      if (vMem)    vMem.textContent    = s.memory;
      if (vProcs)  vProcs.textContent  = s.processes;
      if (vSwap)   vSwap.textContent   = s.swap;
      if (vTemp)   vTemp.textContent   = `${s.temp_c}°C`;
      if (vUptime) vUptime.textContent = fmtUptimeHMS(uptimeFromBaseline());
    } catch (e) {
      console.warn('[stats] refresh failed:', e);
    } finally {
      setTimeout(refreshStats, 10000);
    }
  }

  /* =========================================
     6) Analog Clock
     - Responsive, transparent canvas styled in --config-red.
     - Draws face, ticks, numbers, and hands from server time.
     ========================================= */

  // ----- Analog Clock (transparent, styled in --config-red) -----
  const clockCanvas = document.getElementById('clock');
  const clockCard = document.getElementById('clock-card');

  let clockCtx = null;
  let radius = 0;

  function getThemeRed() {
    const styles = getComputedStyle(document.documentElement);
    const c = styles.getPropertyValue('--config-red').trim();
    return c || '#ff0000';
  }

  function setupClockContext() {
    if (!clockCanvas) return;
    clockCtx = clockCanvas.getContext('2d');
    clockCtx.setTransform(1, 0, 0, 1, 0, 0); // reset
    const r = Math.min(clockCanvas.width, clockCanvas.height) / 2;
    radius = r * 0.90;
    clockCtx.translate(clockCanvas.width / 2, clockCanvas.height / 2);
    clockCtx.lineCap = 'round';
  }

  // 40% smaller than the card width, and always fits the card on small screens
  function resizeClock() {
    if (!clockCanvas || !clockCard) return;
    const containerWidth = clockCard.getBoundingClientRect().width || 260;
    const cssSize = Math.floor(Math.min(containerWidth * 0.60, 420)); // 40% smaller
    const dpr = window.devicePixelRatio || 1;

    clockCanvas.width = Math.max(100, Math.floor(cssSize * dpr));
    clockCanvas.height = clockCanvas.width; // square
    clockCanvas.style.width = cssSize + 'px';
    clockCanvas.style.height = cssSize + 'px';

    setupClockContext();
    drawClock();
  }

  function drawClock() {
    if (!clockCtx) return;
    const ctx = clockCtx;
    const color = getThemeRed();

    // clear full canvas (keeps transparency)
    ctx.clearRect(-clockCanvas.width, -clockCanvas.height, clockCanvas.width * 2, clockCanvas.height * 2);

    drawFace(ctx, radius, color);
    drawNumbers(ctx, radius, color);
    drawTime(ctx, radius, color);
  }

  function drawFace(ctx, r, color) {
    // Transparent background: no fill. Thinner outline + aligned ticks.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = r * 0.035;
    ctx.strokeStyle = color;
    ctx.stroke();

    // minute ticks, 12 o'clock up
    ctx.save();
    ctx.strokeStyle = color;
    for (let i = 0; i < 60; i++) {
      ctx.beginPath();
      ctx.lineWidth = (i % 5 === 0) ? r * 0.012 : r * 0.0065;
      const len = (i % 5 === 0) ? r * 0.10 : r * 0.05;
      ctx.moveTo(0, -r);
      ctx.lineTo(0, -r + len);
      ctx.stroke();
      ctx.rotate(Math.PI / 30);  // rotate AFTER drawing
    }
    ctx.restore();

    // center cap
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawNumbers(ctx, r, color) {
    ctx.save();
    ctx.font = `${r * 0.16}px ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    for (let num = 1; num <= 12; num++) {
      const ang = num * Math.PI / 6;
      ctx.rotate(ang);
      ctx.translate(0, -r * 0.78);
      ctx.rotate(-ang);
      ctx.fillText(String(num), 0, 0);
      ctx.rotate(ang);
      ctx.translate(0, r * 0.78);
      ctx.rotate(-ang);
    }
    ctx.restore();
  }

  function drawTime(ctx, r, color) {
    const now = nowFromBaseline(); // SERVER time
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();

    // thinner hands
    let pos = ((hour % 12) * Math.PI / 6) +
              (minute * Math.PI / (6 * 60)) +
              (second * Math.PI / (360 * 60));
    drawHand(ctx, pos, r * 0.52, r * 0.04, color);

    pos = (minute * Math.PI / 30) + (second * Math.PI / (30 * 60));
    drawHand(ctx, pos, r * 0.86, r * 0.03, color);

    pos = (second * Math.PI / 30);
    drawHand(ctx, pos, r * 0.90, r * 0.012, color);
  }

  function drawHand(ctx, pos, length, width, color) {
    ctx.beginPath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.rotate(pos);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -length);
    ctx.stroke();
    ctx.rotate(-pos);
  }

  /* =========================================
     7) NTP Peer Fetch
     - Populate both hostname and numeric IP (pool rotation-safe).
     ========================================= */

  // ----- NTP server display (populate both: hostname and IP) -----
  const ntpServerSpan = document.getElementById('ntp-server'); // hostname
  const ntpIpSpan = document.getElementById('ntp-ip');         // numeric IP

  async function refreshNtp() {
    if (!ntpServerSpan && !ntpIpSpan) return;
    try {
      const r = await fetch(base + 'ntp', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error('ntp HTTP ' + r.status);
      const j = await r.json();
      if (ntpServerSpan) ntpServerSpan.textContent = j.host || 'n/a';
      if (ntpIpSpan) ntpIpSpan.textContent = j.ip || 'n/a';
    } catch (e) {
      console.warn('[ntp] refresh failed:', e);
    }
  }

  /* =========================================
     8) Power Actions Intercept
     - Avoids navigation/output flashes by posting via fetch.
     - Sends {type:'power', action} to the parent window so main-site power.js
       can immediately dim/undim the page while it polls /config/health.
     ========================================= */

  // ----- Intercept power forms to avoid any navigation/output -----
  function wirePowerForm(formId, action) {
    const form = document.getElementById(formId);
    if (!form) return;

    form.addEventListener('submit', async (ev) => {
      // Stop the default form navigation that causes the brief JSON flash
      ev.preventDefault();

      // Immediately tell the parent to dim (power fade)
      try {
        window.parent.postMessage({ type: 'power', action }, window.location.origin);
      } catch {}

      // Fire the POST via fetch; ignore any response body/output
      try {
        await fetch(form.getAttribute('action'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Accept': 'application/json' }
        });
      } catch {
        // Ignored — the machine may go down before we get a response.
      }
    }, { passive: false });
  }

  /* =========================================
     9) Boot Sequence
     - Initial time sync & first paint (aligned to full second).
     - Periodic time re-sync (1 min), stats (10 s), clock/NTP updates.
     - ResizeObserver for responsive clock sizing.
     ========================================= */

  // --- Boot sequence ---
  (async () => {
    try { await syncTime(); }
    catch (e) {
      console.warn('[time] initial sync failed; falling back to client clock:', e);
      baseEpochMs = Date.now();
      baseUptime  = 0;
      clientSyncMs = Date.now();
      tzAbbr = localTzAbbr();
    }

    // First paint
    renderTick();

    // Align to next whole second
    const toNext = 1000 - (Date.now() % 1000);
    setTimeout(() => {
      renderTick();
      setInterval(renderTick, 1000);
    }, toNext);

    // Periodic time re-sync from the Pi
    setInterval(async () => {
      try { await syncTime(); } catch { /* ignore */ }
    }, 60_000);

    // Start periodic stats refresh (no MOTD polling)
    setTimeout(refreshStats, 10);

    // Initialize clock + dashed rules
    if (clockCanvas && clockCard) {
      resizeClock();
      const ro = new ResizeObserver(() => resizeClock());
      ro.observe(clockCard);
      window.addEventListener('resize', resizeClock, { passive: true });

      const toNextDraw = 1000 - (Date.now() % 1000);
      setTimeout(() => {
        drawClock();
        setInterval(drawClock, 1000);
      }, toNextDraw);
    }

    // Show NTP info (hostname + IP) and refresh periodically (pool rotation)
    await refreshNtp();
    setInterval(refreshNtp, 5 * 60 * 1000);

    // Wire up the power buttons to avoid any navigation/visible output
    wirePowerForm('form-shutdown', 'shutdown');
    wirePowerForm('form-reboot', 'reboot');
  })();
});
