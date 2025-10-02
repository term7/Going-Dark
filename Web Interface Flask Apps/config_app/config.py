#!/usr/bin/env python3
# config.py — Flask backend for the device configuration/MOTD panel.
#
# What it does:
#
# - Serves a two-column configuration page with a live MOTD-style system panel.
# - Exposes read-only JSON endpoints for time, stats, health, and active NTP peer.
# - Renders an analog clock (client canvas) driven by server time baselines.
# - Provides reboot/shutdown POST actions (sudo) without page navigation or output.
# - Sets strict CSP and cache headers for security and correct live-updating.
#
# Section map:
#
# 1) Imports & App Init — Dependencies, logging, and Flask app creation.
# 2) Config / Constants — Interface name (for MAC) and other identifiers.
# 3) System Info Helpers — OS/hostname/MAC, load/memory/procs/temp, uptime formatters.
# 4) NTP Peer Helper — Robust parsing of ntpq output to pick the active/best peer.
# 5) MOTD Section Builders — Header/dynamic/footer HTML blocks for the left column.
# 6) Flask Security Headers — CSP, frame, and cache controls for JSON endpoints.
# 7) Read-only Endpoints — /health, /time, /stats, /ntp and compatibility aliases.
# 8) UI Route: Configuration Panel — Renders the main HTML with actions and clock.
# 9) Actions — sudo-driven reboot/shutdown helpers and POST handlers.
# 10) Entrypoint — Dev/server run block (unused behind a WSGI server but handy locally).
"""
Device configuration panel with MOTD sections, no MOTD polling.

- Header (static; built by Flask)
- Dynamic block (initially rendered; then live-updated via /time and /stats)
- Actions (Shutdown/Reboot)
- Analog clock (uses server time baseline; shows active NTP peer hostname + IP)

Static assets served by nginx under /config/config.css and /config/config.js
"""

# =========================================
# 1) Imports & App Initialization
# =========================================
from flask import Flask, Response, render_template_string, jsonify, request
from jinja2 import TemplateError
import logging, os, subprocess, shutil, socket, time, pwd, re

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("panel-config")

# =========================================
# 2) Config / Constants
# =========================================
# Interface whose MAC we want to show
IFACE = "wlx00c0caae6319"

# Log effective user for sudoers sanity
try:
    app.logger.info(
        "Running as uid=%s user=%s",
        os.geteuid(),
        pwd.getpwuid(os.geteuid()).pw_name
    )
except Exception:
    pass

# =========================================
# 3) System Info Helpers
# =========================================
def _lsb_description() -> str:
    path = "/etc/lsb-release"
    if os.path.exists(path):
        try:
            with open(path) as f:
                for line in f:
                    if line.startswith("DISTRIB_DESCRIPTION="):
                        return line.split("=",1)[1].strip().strip('"')
        except Exception:
            pass
    if shutil.which("lsb_release"):
        try:
            return subprocess.check_output(["lsb_release","-s","-d"], timeout=2).decode().strip()
        except Exception:
            pass
    return "Linux"

def _figlet_hostname() -> str:
    host = socket.gethostname()
    if shutil.which("figlet"):
        try:
            return subprocess.check_output(["figlet", host], timeout=2).decode()
        except Exception:
            pass
    return host

def _get_hostname() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return "n/a"

def _get_mac(ifname: str) -> str:
    try:
        path = f"/sys/class/net/{ifname}/address"
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return "n/a"

ASCII_ART = """
                                 .,::,.
                              .:xKWMMWKd:.
                          .,lkXWWKxooxKWWXkl,.
                        .c0WMN0o;.    .;o0NWN0c.
                        'OMWk,.          .,kWMO'
                        '0MNc              cNM0'
                        'OMNc     °  °     cNM0'
                        'OMNc              cNM0'
                        .OMWx'            'xWMO'
                        .lKWWXOl,.    .,oOXWWKl.
                         .;oONWWKxllxKWWNOo;.
                              'cxXMMMWXkc'
                         .cl,    cXMMXc    ,lc.
                        .xWMXl.  ;XMMX;  .lXMWx.
                 'll;.  lNMMMNx. ;XMMK; .xNMMMNl  .;ll'
                :KMMWKxdKMNO0WWO':XMMK:,OWW0kNMKdxKWMMK:
               lXMNkxKWMMMXc;kWMKON::NOKMNx;cKMMMWKxkXMXl
            .xWM0;   ;KMNdlkXWMMMM:..:MMMMWXkldNMK;   ;0MNx.
           'kWWO'   .OMWd.  .:d0NMM;;MMN0d:.  .dWWk.   'OWWk'
           0WWx.    oWM0'      .,lk00kl,.      'OMWo    .xWW0
           kOl.     :Ok,           ''           ,kO:     .lOk
            Ol.      Ok                         ,kO      .lO"""

def _loadavg1() -> str:
    try:
        return f"{os.getloadavg()[0]:.2f}"
    except Exception:
        return "n/a"

def _mem_swap_usage():
    try:
        mem_total = mem_used = swap_total = swap_used = 0
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                val = int(v.strip().split()[0])
                if k == "MemTotal":
                    mem_total = val
                elif k == "MemAvailable":
                    mem_used = mem_total - val
                elif k == "SwapTotal":
                    swap_total = val
                elif k == "SwapFree":
                    swap_used = max(0, swap_total - val)
        mem_pct = f"{mem_used / mem_total * 100:.1f}%" if mem_total else "n/a"
        swap_pct = f"{swap_used / swap_total * 100:.1f}%" if swap_total else "0.0%"
        return mem_pct, swap_pct
    except Exception:
        return "n/a", "n/a"

def _proc_count() -> str:
    try:
        return str(sum(1 for d in os.listdir("/proc") if d.isdigit()))
    except Exception:
        return "n/a"

def _temp_c() -> str:
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return f"{int(f.read())/1000:.1f}"
    except Exception:
        return "n/a"

def _uptime_s() -> int:
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except Exception:
        return 0

def _uptime_hms(s: int) -> str:
    return f"{s//3600:02d}:{(s%3600)//60:02d}:{s%60:02d}"

# =========================================
# 4) NTP Peer Helper
# =========================================
def _ntp_last_peer():
    """
    Return {"host": <hostname>, "ip": <ip>} for the active (or best) NTP peer.
    Robust parsing of `ntpq -pn` with sensible fallbacks.
    """
    def pick_best(lines):
        star = next((ln for ln in lines if ln.lstrip().startswith('*')), None)
        if star: return star
        cand = next((ln for ln in lines if ln.lstrip().startswith(('+','o'))), None)
        if cand: return cand
        for ln in lines:
            cols = ln.split()
            if len(cols) >= 7:
                try:
                    if int(cols[6], 8) > 0:  # reach in octal
                        return ln
                except Exception:
                    pass
        return lines[0] if lines else None

    try:
        ntpq = shutil.which("ntpq") or "/usr/bin/ntpq"
        out = subprocess.check_output([ntpq, "-pn"], timeout=2, text=True, errors="ignore")
        data_lines = [ln for ln in out.splitlines() if ln.strip() and not ln.startswith(("remote", "="))]
        chosen = pick_best(data_lines)
        if not chosen:
            return {"host": "n/a", "ip": "n/a"}

        remote = chosen.split()[0].lstrip("*#+o-")
        ip = remote
        m = re.search(r'(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-fA-F:]+)', remote)
        if m:
            ip = m.group(0)

        try:
            host = socket.gethostbyaddr(ip)[0]
        except Exception:
            host = ip

        return {"host": host, "ip": ip}
    except Exception:
        return {"host": "n/a", "ip": "n/a"}

# =========================================
# 5) MOTD Section Builders
# =========================================
def build_header() -> str:
    uname = os.uname()
    dash = "-" * 76  # was 80; visually correct gap with right column is at 76
    fig = _figlet_hostname().rstrip("\n")
    ascii_block = ASCII_ART.rstrip("\n")
    return "\n".join([
        f"<span class='motd-strong-pre'>{fig}</span>",
        f"* {_lsb_description()} ({uname.release} {uname.machine}).",
        "",
        dash,
        f"<span class='motd-strong-pre'>{ascii_block}</span>",
        dash
    ]) + "\n"

def build_dynamic(now_ts: float | None = None, up_s: int | None = None) -> str:
    if now_ts is None:
        now_ts = time.time()
    if up_s is None:
        up_s = _uptime_s()
    date_str = time.strftime("%a %b %d %H:%M:%S %Z %Y", time.localtime(now_ts))
    load = _loadavg1()
    mem_pct, swap_pct = _mem_swap_usage()
    procs = _proc_count()
    temp_c = _temp_c()
    up_fmt = _uptime_hms(up_s)
    dash = "-" * 76  # was 80; keep consistent with header

    def val(id_, text): return f"<span class='motd-val' id='{id_}'>{text}</span>"

    return "\n".join([
        "",
        "",
        f"System Information: {val('si-date', date_str)}",
        "",
        f"System Load:\t{val('stat-load', load)}\t     Memory Usage:\t{val('stat-mem', mem_pct)}",
        f"Processes:\t{val('stat-procs', procs)}\t     Swap Usage:\t{val('stat-swap', swap_pct)}",
        f"CPU Temp.:\t{val('stat-temp', temp_c + '°C')}\t     System Uptime:\t{val('stat-uptime', up_fmt)}",
        "",
        dash
    ]) + "\n"

def build_footer() -> str:
    tail = "/etc/motd.tail"
    if os.path.exists(tail):
        try:
            with open(tail) as f:
                data = f.read()
            if not data.endswith("\n"):
                data += "\n"
            return data
        except Exception:
            pass
    return ""

# =========================================
# 6) Flask Security Headers
# =========================================
# ---------- Flask security headers ----------
@app.after_request
def headers(resp):
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'none'; "
        "style-src 'self'; font-src 'self' data:; img-src 'self' data:; "
        "connect-src 'self'; script-src 'self'; "
        "frame-ancestors 'self'; base-uri 'none'; form-action 'self'"
    )
    if request.path.endswith((
        "/time", "/stats", "/config/time", "/config/stats",
        "/action/reboot", "/action/shutdown", "/health", "/ntp"
    )):
        resp.headers["Cache-Control"] = "no-store, max-age=0"
        resp.headers["Pragma"] = "no-cache"
    return resp

# =========================================
# 7) Read-only Endpoints
# =========================================
# ---------- Read-only endpoints ----------
@app.route("/health")
def health():
    return jsonify(status="ok")

@app.route("/time")
def api_time():
    return jsonify({
        "epoch": int(time.time()),
        "uptime": _uptime_s(),
        "tz": time.strftime("%Z")
    })

@app.route("/stats")
def api_stats():
    load = _loadavg1()
    mem_pct, swap_pct = _mem_swap_usage()
    procs = _proc_count()
    temp_c = _temp_c()
    return jsonify({
        "load": load,
        "memory": mem_pct,
        "swap": swap_pct,
        "processes": procs,
        "temp_c": temp_c
    })

@app.route("/ntp")
def api_ntp():
    return jsonify(_ntp_last_peer())

@app.route("/config/time")
def api_time_alias(): return api_time()

@app.route("/config/stats")
def api_stats_alias(): return api_stats()

# =========================================
# 8) UI Route: Configuration Panel
# =========================================
# ---------- UI ----------
@app.route("/", methods=["GET"])
def index():
    tpl = """
<!doctype html>
<html lang="en">
  <head>
    <!-- =========================
         1) Head (meta / assets)
         ========================= -->
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Device Configuration</title>
    <link rel="stylesheet" href="/config/config.css">
    <script src="/config/config.js" defer></script>
  </head>
  <body>
    <!-- =========================
         2) Main Layout Grid
         - Two columns: 
           • LEFT = MOTD sections
           • RIGHT = Actions + Analog Clock
         ========================= -->
    <div class="config-grid">
      
      <!-- =========================================
           LEFT COLUMN: MOTD (system info panel)
           - Three pre blocks populated by Flask:
             • #motd-header   — figlet + OS + ASCII art
             • #motd-dynamic  — load/mem/procs/temp/uptime
             • #motd-footer   — tail text if available
           ========================================= -->
      <div class="config-col">
        <div class="card motd-card">
          <pre class="motd-pre" id="motd-header" aria-hidden="true">{{ header|safe }}</pre>
          <pre class="motd-pre" id="motd-dynamic" aria-hidden="true">{{ dynamic|safe }}</pre>
          <pre class="motd-pre" id="motd-footer" aria-hidden="true">{{ footer|safe }}</pre>
        </div>
      </div>

      <!-- =========================================
           RIGHT COLUMN: Device Actions + Clock
           ========================================= -->
      <div class="config-col">
        
        <!-- ===== Device Control Card ===== -->
        <div class="card" id="actions-card">
          <h2 class="config-title">Device Control</h2>

          <!-- Hostname / MAC status line -->
          <div class="config-status">
            <div class="config-kv">
              <span class="config-kv-label">Hostname:</span><br/>
              <span class="config-kv-value motd-val">{{ host }}</span>
            </div>

            <div class="config-kv-spacer"></div>

            <div class="config-kv">
              <span class="config-kv-label">MAC address:</span><br/>
              <span class="config-kv-value motd-val">{{ mac }}</span>
            </div>
          </div>

          <!-- Shutdown / Reboot forms -->
          <div class="config-btnrow config-btnbar">
            <form method="post" action="action/shutdown" id="form-shutdown" class="config-form">
              <button type="submit" class="config-btn" id="btn-shutdown" data-action="shutdown">SHUTDOWN NOW</button>
            </form>
            <form method="post" action="action/reboot" id="form-reboot" class="config-form">
              <button type="submit" class="config-btn" id="btn-reboot" data-action="reboot">REBOOT NOW</button>
            </form>
          </div>

          <!-- Note about randomized IDs -->
          <div class="config-statusline"><strong>Reboot:</strong> New <u>random hostname</u> and <u>random MAC address</u>!</div>
        </div>

        <!-- ===== Analog Clock Card ===== -->
        <div class="card clock-card" id="clock-card" aria-label="Analog clock showing Raspberry Pi system time">
          <div class="clock-info" aria-hidden="true"><strong>S-Y-S-T-E-M / C-L-O-C-K</strong></div>
          <div class="clock-info" aria-hidden="true">&nbsp;</div>

          <!-- Canvas-driven analog clock (client-side JS) -->
          <canvas id="clock" role="img" aria-label="Analog clock"></canvas>

          <div class="clock-info" aria-hidden="true">&nbsp;</div>

          <!-- Active NTP peer info -->
          <div class="clock-info">NTP Server: <span id="ntp-server" class="motd-val">…</span></div>
          <div class="clock-info">NTP Server IP: <span id="ntp-ip" class="motd-val">…</span></div>

          <!-- Decorative separators -->
          <div class="clock-info" aria-hidden="true">&nbsp;</div>
          <div class="clock-info" aria-hidden="true">* * *</div>
          <div class="clock-info" aria-hidden="true">&nbsp;</div>
          
          <!-- External reference link -->
          <div class="clock-info"><a href="https://www.ntppool.org/en/" target="_blank" rel="noopener">https://www.ntppool.org/en/</a></div>
        </div>

      </div>
    </div>
  </body>
</html>
"""
    try:
        return render_template_string(
            tpl,
            header=build_header(),
            dynamic=build_dynamic(),
            footer=build_footer(),
            host=_get_hostname(),
            mac=_get_mac(IFACE),
        )
    except TemplateError as te:
        logger.exception("Template error: %s", te)
        return Response("Template error", status=500, mimetype="text/plain; charset=utf-8")

# =========================================
# 9) Actions
# =========================================
# ---------- Actions ----------
SUDO_BIN     = "/usr/bin/sudo"
SHUTDOWN_BIN = "/usr/sbin/shutdown"
REBOOT_BIN   = "/usr/sbin/reboot"

def _run(cmd):
    """Run command, capturing stdout/stderr; return (ok, msg)."""
    try:
        cp = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        out = (cp.stdout or "").strip()
        err = (cp.stderr or "").strip()
        msg = out if out else err
        return True, msg
    except subprocess.CalledProcessError as e:
        return False, (e.stderr or str(e)).strip()
    except Exception as e:
        return False, str(e)

@app.route("/action/shutdown", methods=["POST"])
def do_shutdown():
    ok, msg = _run([SUDO_BIN, SHUTDOWN_BIN, "-h", "now"])
    return jsonify({"ok": ok, "action": "shutdown", "message": msg}), (200 if ok else 500)

@app.route("/action/reboot", methods=["POST"])
def do_reboot():
    ok, msg = _run([SUDO_BIN, REBOOT_BIN])
    return jsonify({"ok": ok, "action": "reboot", "message": msg}), (200 if ok else 500)

# =========================================
# 10) Entrypoint
# =========================================
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5002, debug=False)
