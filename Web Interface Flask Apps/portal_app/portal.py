# portal.py — Flask backend for the network control portal.

# What it does:

# - Serves the main HTML page and JSON endpoints that the frontend calls.
# - Scans Wi-Fi (via `iw`), connects/disconnects Wi-Fi (via `nmcli`).
# - Manages a local hotspot (change SSID/password, start/stop), and generates a Wi-Fi QR.
# - Toggles mutually exclusive privacy services: WireGuard VPN vs Tor transparent proxy.
# - Provides server-side public IP and geolocation lookups for the UI display.
# - Includes helpers to wait for NetworkManager to settle so the UI reflects real, stable states.

# Section map:

# 1) Imports & App Init — Dependencies, optional segno, and Flask app creation.
# 2) Config / Constants — Interface names, connection profile IDs, env, absolute paths.
# 3) NM Introspection Helpers — Read NM device/connection state; derive current SSID.
# 4) NM Controls & Autoconnect — Up/Down helpers, autoconnect get/set, result→JSON helpers.
# 5) NM State Stabilization — Wait loop to confirm target active connections are stable.
# 6) iw Utilities & Parsing — Sudo wrapper, dBm→%, parser, and security classification.
# 7) Hotspot Helpers — Read hotspot SSID/security; count connected stations.
# 8) Wi-Fi QR Helpers — Safe escaping + read WPA2/WPA3 secret for QR payload.
# 9) Route: HTML Portal — Returns the main page with placeholders for the frontend.
# 10) Routes: Status & Scanning — Current SSID, composite service status, scan/parse, Wi-Fi connect/disconnect.
# 11) Routes: WireGuard / Tor — Start/stop with mutual exclusion and stabilized reporting.
# 12) Routes: Hotspot — Configure SSID/PSK, start/stop, info, and client count.
# 13) Routes: Server IP/Geo — Server-resolved public IPv4 and geolocation for the UI.
# 14) Route: Hotspot QR (SVG) — Generate inline SVG QR with colored dark modules.
# 15) Entrypoint — Dev/server run block (unused by Gunicorn but handy for local testing).


# =========================================
# 1) Imports & App Initialization
# =========================================
from flask import Flask, request, jsonify, make_response
import html, subprocess, os, time, json, ipaddress
import io
import shutil
try:
    import segno  # installed in your venv
except Exception:
    segno = None

app = Flask(__name__)

# =========================================
# 2) Config / Constants (Interfaces, Profiles, Binaries)
# =========================================

# Wi-Fi adapter to manage (client mode)
CONNECT_IFACE = "wlx00c0caae6319"

# Hotspot specifics (profile uses wlan0; no conflict with CONNECT_IFACE)
HOTSPOT_IFACE = "wlan0"
HOTSPOT_CONN = "Hotspot"

# VPN / Proxy connection names (exact profile names)
WG_CONN = "term7.wireguard"
TOR_CONN = "torproxy"

# Environment for nmcli (status/connect/disconnect only)
NM_ENV = {**os.environ, "LC_ALL": "C", "LANG": "C"}

# Absolute iw path (must match your sudoers entry)
IW_BIN = "/usr/sbin/iw"

# Absolute nmcli path (to match sudoers entry you created)
NMCLI_BIN = shutil.which("nmcli") or "/usr/bin/nmcli"


# =========================================
# 3) NetworkManager: Device & Connection Introspection Helpers
# =========================================
def nm_device_table():
    try:
        out = subprocess.check_output(
            [NMCLI_BIN, "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"],
            text=True, env=NM_ENV, timeout=3
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return {}
    table = {}
    for line in out.strip().splitlines():
        dev, typ, state, conn = (line.split(":", 3) + ["", "", "", ""])[:4]
        table[dev] = {"type": typ, "state": (state or "").lower(), "conn": conn}
    return table

def _ssid_from_connection_name(conn_name: str):
    if not conn_name:
        return None
    try:
        raw = subprocess.check_output(
            [NMCLI_BIN, "-t", "-f", "802-11-wireless.ssid", "connection", "show", conn_name],
            text=True, env=NM_ENV, timeout=3
        ).strip()
        ssid = raw.split(":", 1)[-1] if ":" in raw else raw
        return ssid or conn_name
    except Exception:
        return conn_name or None

def get_current_ssid_connect_iface_only():
    """Return SSID only if CONNECT_IFACE is connected; otherwise None."""
    table = nm_device_table()
    info = table.get(CONNECT_IFACE)
    if info and (info.get("state") or "").startswith("connected"):
        return _ssid_from_connection_name(info.get("conn") or "")
    return None


# =========================================
# 4) NetworkManager: Simple Connection Controls & Autoconnect
# =========================================
def nm_con_up(name: str, timeout=30):
    return subprocess.run(
        [NMCLI_BIN, "--colors", "no", "con", "up", name],
        capture_output=True, text=True, env=NM_ENV, timeout=timeout
    )

def nm_con_down(name: str, timeout=30):
    return subprocess.run(
        [NMCLI_BIN, "--colors", "no", "con", "down", name],
        capture_output=True, text=True, env=NM_ENV, timeout=timeout
    )

def nm_has_connection(name: str) -> bool:
    """Return True if a connection profile with this exact name exists."""
    try:
        # Primary: list all connection names and do an exact match.
        out = subprocess.check_output(
            [NMCLI_BIN, "-t", "-f", "NAME", "connection", "show"],
            text=True, env=NM_ENV, timeout=3
        )
        names = [ln.strip() for ln in out.splitlines() if ln.strip()]
        if name in names:
            return True
    except Exception:
        pass

    # Fallback: query this profile's id directly.
    try:
        out = subprocess.check_output(
            [NMCLI_BIN, "-g", "connection.id", "connection", "show", name],
            text=True, env=NM_ENV, timeout=3
        )
        return out.strip() == name
    except Exception:
        return False

def nm_set_autoconnect(name: str, enabled: bool):
    """Best-effort set autoconnect; ignore errors if profile missing."""
    try:
        return subprocess.run(
            [NMCLI_BIN, "--colors", "no", "con", "mod", name, "connection.autoconnect", "yes" if enabled else "no"],
            capture_output=True, text=True, env=NM_ENV, timeout=6
        )
    except Exception:
        return None

def nm_get_autoconnect(name: str) -> bool:
    """Return True if 'connection.autoconnect' is enabled for this profile."""
    try:
        out = subprocess.check_output(
            [NMCLI_BIN, "-t", "-f", "connection.autoconnect", "connection", "show", name],
            text=True, env=NM_ENV, timeout=3
        ).strip()
        val = out.split(":", 1)[-1].strip().lower() if out else ""
        return val.startswith("y")
    except Exception:
        return False

def _ok(res) -> bool:
    return res and res.returncode == 0

def _json_from_nm(result):
    return {
        "ok": _ok(result),
        "rc": result.returncode if result else -1,
        "stdout": (result.stdout or "")[:400],
        "stderr": (result.stderr or "")[:400],
    }

def active_connection_names():
    """Return a set of active connection names (lowercased). Exact-match friendly."""
    try:
        out = subprocess.check_output(
            [NMCLI_BIN, "-t", "-f", "NAME,ACTIVE", "con", "show", "--active"],
            text=True, env=NM_ENV, timeout=3
        )
        names = set()
        for line in out.strip().splitlines():
            name, active = (line.split(":", 1) + ["", ""])[:2]
            if (active or "").lower().startswith("yes"):
                names.add((name or "").strip().lower())
        return names
    except Exception:
        return set()

def service_status_payload():
    names = active_connection_names()
    wg_cfg = nm_has_connection(WG_CONN)
    return {
        "ssid_connect": get_current_ssid_connect_iface_only(),
        "hotspot": (HOTSPOT_CONN.lower() in names),
        "wireguard": (WG_CONN.lower() in names),
        "torproxy": (TOR_CONN.lower() in names),
        "hotspot_iface": HOTSPOT_IFACE,
        "wifi_iface": CONNECT_IFACE,
        # Advertise whether WG profile exists so UI can show "Not Configured"
        "wireguard_configured": wg_cfg,
        # Advertise WG autoconnect status so UI/logic can react quickly
        "wireguard_autoconnect": (nm_get_autoconnect(WG_CONN) if wg_cfg else False),
    }


# =========================================
# 5) Stabilization: Wait for NM State (Exact-Match)
# =========================================
def _wait_nm_state_exact(target_present=None, target_absent=None, timeout=60.0, interval=0.25):
    target_present = set((t or "").strip().lower() for t in (target_present or []))
    target_absent = set((t or "").strip().lower() for t in (target_absent or []))
    t0 = time.time()
    stable_hits = 0
    while True:
        names = active_connection_names()
        ok_present = all(tp in names for tp in target_present) if target_present else True
        ok_absent  = all(ta not in names for ta in target_absent) if target_absent else True
        if ok_present and ok_absent:
            stable_hits += 1
            if stable_hits >= 2:
                return names, True
        else:
            stable_hits = 0
        if time.time() - t0 >= timeout:
            return names, False
        time.sleep(interval)


# =========================================
# 6) iw Utilities: sudo wrapper, parsing helpers, security classification
# =========================================
def sudo_iw(args, timeout=6):
    proc = subprocess.run(["sudo", "-n", IW_BIN] + args,
                          capture_output=True, text=True, timeout=timeout)
    return proc.returncode, proc.stdout, proc.stderr

def dbm_to_pct(dbm):
    try:
        v = float(dbm)
    except Exception:
        return ""
    pct = int(round(2 * (v + 100)))
    return str(min(100, max(0, pct)))

_HEADER_PREFIX_BLACKLIST = (
    "Supported rates", "Extended supported rates", "capability", "DS Parameter set",
    "HT capabilities", "HT operation", "VHT capabilities", "VHT operation",
    "HE capabilities", "HE operation", "BSS Load", "Country",
)

def _valid_ssid(ssid: str) -> bool:
    if not ssid:
        return False
    try:
        ssid.encode("utf-8", errors="strict")
    except Exception:
        return False
    if len(ssid.encode("utf-8")) == 0 or len(ssid.encode("utf-8")) > 32:
        return False
    if not ssid.isprintable() or any(ch in ssid for ch in ("\n", "\r", "\t")):
        return False
    prefix = ssid.split(":", 1)[0].strip()
    for bad in _HEADER_PREFIX_BLACKLIST:
        if prefix.startswith(bad):
            return False
    return True

def classify_security(block_text: str) -> str:
    import re
    t = block_text
    has_rsn = "RSN:" in t
    has_wpa = "\n\tWPA:" in t or "\n WPA:" in t
    has_privacy = re.search(r"^\s*capability:\s.*Privacy", t, re.MULTILINE) is not None
    akm_sae = re.search(r"Authentication suites:.*SAE", t)
    akm_psk = re.search(r"Authentication suites:.*PSK", t)
    akm_8021x = re.search(r"Authentication suites:.*802\.1X", t)
    akm_owe = re.search(r"Authentication suites:.*OWE", t)
    has_gcmp256 = re.search(r"(GCMP-256|BIP-GMAC-256|BIP-GCMP-256)", t) is not None
    akm_9_or_13 = re.search(r"00-0f-ac:(9|13)", t) is not None

    if akm_owe:
        return "OWE (no password)"
    if has_rsn or has_wpa:
        if akm_8021x:
            if has_gcmp256 or akm_9_or_13:
                return "WPA3-Enterprise"
            return "WPA2-Enterprise"
        if akm_sae:
            return "WPA3"
        if akm_psk:
            return "WPA2"
        if has_wpa and not has_rsn:
            return "WPA"
        return "secured"
    if has_privacy:
        return "WEP"
    return "open"

def parse_iw_scan_dump(text: str):
    import re
    lines = text.splitlines()
    results = {}
    block_lines = []
    push_blocks = []

    for ln in lines:
        if ln.startswith("BSS "):
            if block_lines:
                push_blocks.append("\n".join(block_lines))
                block_lines = []
            block_lines.append(ln)
        else:
            block_lines.append(ln)
    if block_lines:
        push_blocks.append("\n".join(block_lines))

    ssid_re = re.compile(r"^\s*SSID:\s*(.*)\s*$", re.MULTILINE)
    sig_re = re.compile(r"^\s*signal:\s*(-?\d+(\.\d+)?)\s*dBm", re.MULTILINE)

    for blk in push_blocks:
        m_ssid = ssid_re.search(blk)
        if not m_ssid:
            continue
        ssid = (m_ssid.group(1) or "").strip()
        if not _valid_ssid(ssid):
            continue

        m_sig = sig_re.search(blk)
        dbm = m_sig.group(1) if m_sig else None
        signal_pct = dbm_to_pct(dbm) if dbm is not None else ""
        sec_label = classify_security(blk)

        prev = results.get(ssid)
        if prev is None:
            results[ssid] = {"ssid": ssid, "signal": signal_pct, "security": sec_label}
        else:
            def sigval(x):
                s = (x.get("signal") or "").strip()
                return int(s) if s.isdigit() else -1
            if sigval({"signal": signal_pct}) > sigval(prev):
                results[ssid] = {"ssid": ssid, "signal": signal_pct, "security": sec_label}

    nets = list(results.values())
    nets.sort(key=lambda n: int(n["signal"]) if (n.get("signal") or "").isdigit() else -1, reverse=True)

    cur_ssid = get_current_ssid_connect_iface_only()
    for n in nets:
        n["inuse"] = (cur_ssid is not None and n["ssid"] == cur_ssid)
    return nets

def options_html_for(nets):
    options_html = ""
    for n in nets:
        safe_ssid = html.escape(n["ssid"])
        sig_raw = (n.get("signal") or "").strip()
        label = safe_ssid
        sec = n.get("security") or "open"
        if n.get("inuse"):
            label += " (connected)"
        label += f" — {html.escape(sec)}"
        if not sig_raw or (sig_raw.isdigit() and int(sig_raw) <= 0):
            label += " · (initializing)"
        options_html += f'<option value="{safe_ssid}">{label}</option>\n'
    return options_html


# =========================================
# 7) Hotspot: Info & Client Counting Helpers
# =========================================
def nm_hotspot_info():
    fields = "802-11-wireless.ssid,802-11-wireless-security.key-mgmt,802-11-wireless-security.proto"
    try:
        out = subprocess.check_output(
            [NMCLI_BIN, "-t", "-f", fields, "connection", "show", HOTSPOT_CONN],
            text=True, env=NM_ENV, timeout=3
        ).strip()
    except Exception:
        return {"ssid": None, "security": None}

    info = {"ssid": None, "security": None}
    for line in out.splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        val = (val or "").strip()
        if key.endswith("802-11-wireless.ssid"):
            info["ssid"] = val or None
        elif key.endswith("802-11-wireless-security.key-mgmt"):
            km = (val or "").lower()
            if "sae" in km:
                info["security"] = "WPA3"
            elif "wpa-psk" in km:
                info["security"] = "WPA2"
    return info

def count_hotspot_clients():
    try:
        rc, out, err = sudo_iw(["dev", HOTSPOT_IFACE, "station", "dump"], timeout=3)
        if rc != 0:
            return 0
        count = sum(1 for ln in out.splitlines() if ln.strip().startswith("Station "))
        return int(count)
    except Exception:
        return 0


# =========================================
# 8) Wi-Fi QR Helpers (Escaping & Secrets)
# =========================================
def _wifi_escape(s: str) -> str:
    if not isinstance(s, str):
        return ""
    return s.replace("\\", "\\\\").replace(";", r"\;").replace(",", r"\,").replace(":", r"\:")

def _read_hotspot_psk():
    """Return WPA password for Hotspot profile, supporting WPA2-PSK and WPA3-SAE."""
    # Try SAE (WPA3-Personal) first
    try:
        out = subprocess.check_output(
            ["sudo", "-n", NMCLI_BIN, "-s", "-g", "802-11-wireless-security.sae-password",
             "connection", "show", HOTSPOT_CONN],
            text=True, env=NM_ENV, timeout=4
        ).strip()
        if out:
            return out
    except Exception:
        pass
    # Fallback to PSK (WPA2-Personal)
    try:
        out = subprocess.check_output(
            ["sudo", "-n", NMCLI_BIN, "-s", "-g", "802-11-wireless-security.psk",
             "connection", "show", HOTSPOT_CONN],
            text=True, env=NM_ENV, timeout=4
        ).strip()
        return out or None
    except Exception:
        return None


# =========================================
# 9) Routes: HTML Portal (Index)
# =========================================
@app.route("/")
def index():
    ssid_now = get_current_ssid_connect_iface_only()
    status = html.escape(ssid_now) if ssid_now else "Disconnected"
    html_template = """<!doctype html>
<html lang="en">
<head>
  <!-- =========================
       1) Head (meta / assets)
       ========================= -->
  <meta charset="utf-8">
  <title>Portal</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/portal/portal.css">
  <script src="/portal/portal.js" defer></script>
</head>
<body>
  <!-- =========================
       2) Main Layout Grid
       - Two columns:
         • LEFT  — Wi-Fi & Hotspot controls
         • RIGHT — VPN/Tor status + notices
       ========================= -->
  <div class="portal-grid">

    <!-- =========================================
         LEFT COLUMN
         ========================================= -->
    <div class="portal-col portal-col-left">
      <!-- =========================================
           Card 1: Wi-Fi Portal
           - Live SSID + scan results
           - Connect / Disconnect actions
           ========================================= -->
      <section id="wifi-card" class="card">
        <h2 class="portal-title">Wi-Fi Portal</h2>
        <div class="portal-status">
          Wi-Fi Interface: <b>__IFACE__</b><br/>
          Current Network: <b id="current-ssid">__STATUS__</b>
        </div>
        <div class="portal-btnbar portal-btnrow">
          <button class="portal-btn btn-toggle-fixed" id="btn-toggle" type="button">Pause Background Scans</button>
        </div>
        <div id="scan-status" class="portal-statusline portal-scanmsg">
          <span id="scan-base">Available: </span><span id="scan-dynamic">Loading…</span>
        </div>
        <form id="wifi-form" action="submit" method="post" class="portal-form">
          <div class="portal-row">
            <label for="ssid">Choose a Wi-Fi network:</label><br/>
            <select name="ssid" id="ssid" class="portal-select" required>
            </select>
          </div>
          <div class="portal-row">
            <label for="password">Password (leave empty for open networks):</label><br/>
            <input type="password" name="password" id="password" class="portal-input" autocomplete="off" />
          </div>
          <div class="portal-row">
            <span class="portal-btnrow">
              <button class="portal-btn btn-wifi-pair" id="btn-connect" type="submit">Connect</button>
              <button class="portal-btn btn-wifi-pair" id="btn-disconnect" type="button">Disconnect</button>
            </span>
          </div>
        </form>
      </section>

      <!-- =========================================
           Card 3: Hotspot Control
           - Activate/deactivate AP
           - Change SSID/password
           - QR code to join
           ========================================= -->
      <section id="hotspot-card" class="card">
        <h2 class="portal-title">Hotspot Control</h2>

        <div class="portal-status">
          Hotspot Interface: <b>__HIFACE__</b><br/>
          Hotspot: <b id="hotspot-state">Inactive</b>
        </div>

        <!-- Unified two-column layout: button+inputs (left) // QR (right) -->
        <div class="hotspot-grid">
          <div class="hotspot-left">
            <div class="portal-btnbar portal-btnrow hotspot-toprow">
              <button class="portal-btn btn-wifi-pair" id="btn-hotspot-toggle" type="button">Hotspot: Activate</button>
            </div>

            <div id="hotspot-clients" class="portal-statusline portal-scanmsg">
              Connected Clients: <b id="hotspot-clients-count">0</b>
            </div>

            <form id="hotspot-form" class="portal-form" action="hotspot/up" method="post">
              <div class="portal-row">
                <label for="hotspot-ssid">Change Hotspot SSID:</label><br/>
                <input type="text" name="ssid" id="hotspot-ssid" class="portal-input hs-samewidth" autocomplete="off" />
              </div>
              <div class="portal-row hs-pw-row">
                <label for="hotspot-password">Set new password:</label><br/>
                <input type="password" name="password" id="hotspot-password" class="portal-input hs-samewidth" autocomplete="off" />
              </div>

              <div class="portal-statusline portal-scanmsg qr-hint">Scan to join Hotspot:</div>
            </form>
          </div>

          <div class="hotspot-right">
            <div class="qr-wrap qr-size-match">
              <img id="hotspot-qr" alt="Hotspot Wi-Fi QR" src="hotspot/qr.svg?b=0"/>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- =========================================
         RIGHT COLUMN
         ========================================= -->
    <div class="portal-col portal-col-right">
      <!-- =========================================
           Card 2: WireGuard VPN // Tor Transparent Proxy
           - Toggle service states
           - IP/UA/Geo diagnostics
           ========================================= -->
      <section id="vpn-card" class="card">
        <h2 class="portal-title">Wireguard VPN // Tor Transparent Proxy</h2>
        <div class="portal-status">
          WireGuard VPN: <b id="wg-state">Disconnected</b><span id="wg-auto"></span><br/>
          Tor Transparent Proxy: <b id="tor-state">Disconnected</b>
        </div>
        <div class="portal-btnbar portal-btnrow">
          <button class="portal-btn btn-svc-pair" id="btn-wg-toggle" type="button">WireGuard: Connect</button>
          <button class="portal-btn btn-svc-pair" id="btn-tor-toggle" type="button">TorProxy: Connect</button>
        </div>
        <div id="ipgeo-status" class="portal-statusline portal-scanmsg"></div>
        <p class="vpn-note">
          Note: WireGuard auto-connects. Disconnect manually if you don’t want all traffic routed through the VPN on system startup.
        </p>
      </section>

      <!-- =========================================
           Card 4: Tor Notice
           - Hidden by default; fades in on connect
           ========================================= -->
      <section id="tor-ascii-card" class="card tor-card" aria-live="polite" hidden>
        <div class="tor-content">
            <p class="tor-connect">
            SYSTEM-WIDE PROTECTION ACTIVE!
            </p>
        </div>
        <div class="tor-content">
            <p class="tor-connect">
            * * *
            </p>
        </div>
        <div class="tor-content">
            <p class="tor-connect tor-warning">
            Important Warning: Even though all your device's traffic is now routed through the Tor network, it does not make your browsing fully anonymous.<br/>
            If you continue using a regular browser, you can still be fingerprinted and easily identified.
            </p>
        </div>
        <div class="tor-content">
            <p class="tor-connect">
            *
            </p>
        </div>
        <div class="tor-content">
            <p class="tor-connect">
            To browse anonymously, you must use the Tor Browser:
            <a href="https://www.torproject.org/download/" target="_blank" rel="noopener noreferrer">
                https://www.torproject.org/download/
            </a>
            </p>
        </div>
      </section>

      <!-- =========================================
           Card 5: Offline Notice
           - Hidden by default; loops while Wi-Fi is disconnected
           ========================================= -->
      <section id="offline-ascii-card" class="card offline-card" aria-live="polite" hidden>
        <pre class="offline-pre">
###############################
#                             #
#   W-I-F-I / O-F-F-L-I-N-E   #
#                             #
###############################
        </pre>
      </section>

    </div>
  </div>
</body>
</html>"""
    html_page = (
        html_template
        .replace("__IFACE__", html.escape(CONNECT_IFACE))
        .replace("__STATUS__", status)
        .replace("__HIFACE__", html.escape(HOTSPOT_IFACE))
    )
    return html_page

# =========================================
# 10) Routes: Lightweight JSON Status & Scanning
# =========================================
@app.route("/status")
def status_route():
    ssid_now = get_current_ssid_connect_iface_only()
    resp = jsonify({"ssid_connect": ssid_now})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp, 200

@app.route("/svc_status")
def svc_status():
    payload = service_status_payload()
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp, 200

@app.route("/bgscan_iw", methods=["POST"])
def bgscan_iw():
    rc, out, err = sudo_iw(["dev", CONNECT_IFACE, "scan", "trigger"], timeout=4)
    ok = (rc == 0) or ("busy" in (err or "").lower())
    resp = jsonify(ok=ok, rc=rc)
    resp.headers["Cache-Control"] = "no-store"
    return (resp, 200) if ok else (resp, 500)

@app.route("/scan_iw_dump")
def scan_iw_dump():
    rc, out, err = sudo_iw(["dev", CONNECT_IFACE, "scan", "dump"], timeout=6)
    nets = parse_iw_scan_dump(out) if rc == 0 else []

    # Always hide the SSID configured in the "Hotspot" profile
    try:
        hs_ssid = (nm_hotspot_info().get("ssid") or "").strip()
        if hs_ssid:
            nets = [n for n in nets if n.get("ssid") != hs_ssid]
    except Exception:
        pass

    resp = make_response(options_html_for(nets))
    resp.mimetype = "text/html"
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp


@app.route("/disconnect", methods=["POST"])
def disconnect_route():
    try:
        subprocess.run(
            [NMCLI_BIN, "device", "disconnect", "ifname", CONNECT_IFACE],
            capture_output=True, text=True, env=NM_ENV, timeout=8
        )
    except Exception as e:
        resp = jsonify(ok=False, error=str(e)[:200])
        resp.headers["Cache-Control"] = "no-store"
        return resp, 500
    resp = jsonify(ok=True)
    resp.headers["Cache-Control"] = "no-store"
    return resp, 200

@app.route("/submit", methods=["POST"])
def submit():
    ssid = request.form.get("ssid", "")
    password = request.form.get("password", "")
    if not ssid:
        return jsonify(ok=False), 400
    cmd = [NMCLI_BIN, "--colors", "no", "device", "wifi", "connect", ssid, "ifname", CONNECT_IFACE]
    if password:
        cmd += ["password", password]
    result = subprocess.run(cmd, capture_output=True, text=True, env=NM_ENV, timeout=30)
    if result.returncode != 0:
        return jsonify(ok=False, error=(result.stderr or result.stdout)[:200]), 400
    return jsonify(ok=True), 200


# =========================================
# 11) Routes: Service Controls (WireGuard / Tor)
# =========================================
@app.route("/wg/up", methods=["POST"])
def wireguard_up():
    # If WG profile is missing, respond gracefully
    if not nm_has_connection(WG_CONN):
        resp = jsonify({"ok": False, "error": "wireguard profile not found", "configured": False})
        resp.headers["Cache-Control"] = "no-store"
        return resp, 404

    # Ensure Tor is down first (mutual exclusion), but do NOT touch WG autoconnect here
    nm_con_down(TOR_CONN)
    _ = _wait_nm_state_exact(target_absent={TOR_CONN}, timeout=60.0)

    # Set autoconnect yes on WG before bringing it up
    _ = nm_set_autoconnect(WG_CONN, True)

    r = nm_con_up(WG_CONN)
    names, settled = _wait_nm_state_exact(target_present={WG_CONN}, target_absent={TOR_CONN}, timeout=60.0)
    resp = jsonify({**_json_from_nm(r), "settled": settled, "active": sorted(names), "configured": True})
    resp.headers["Cache-Control"] = "no-store"
    return (resp, 200) if _ok(r) else (resp, 500)

@app.route("/wg/down", methods=["POST"])
def wireguard_down():
    r = nm_con_down(WG_CONN)
    names, settled = _wait_nm_state_exact(target_absent={WG_CONN}, timeout=60.0)

    # Set autoconnect no on WG after bringing it down (best effort)
    _ = nm_set_autoconnect(WG_CONN, False)

    resp = jsonify({**_json_from_nm(r), "settled": settled, "active": sorted(names), "configured": nm_has_connection(WG_CONN)})
    resp.headers["Cache-Control"] = "no-store"
    return (resp, 200) if _ok(r) else (resp, 500)

@app.route("/wg/down_keep_auto", methods=["POST"])
def wireguard_down_keep_auto():
    # Graceful if profile is missing
    if not nm_has_connection(WG_CONN):
        resp = jsonify({"ok": False, "error": "wireguard profile not found", "configured": False})
        resp.headers["Cache-Control"] = "no-store"
        return resp, 404

    # Bring WG down, but DO NOT touch autoconnect here
    r = nm_con_down(WG_CONN)
    names, settled = _wait_nm_state_exact(target_absent={WG_CONN}, timeout=60.0)

    resp = jsonify({**_json_from_nm(r), "settled": settled, "active": sorted(names), "configured": True})
    resp.headers["Cache-Control"] = "no-store"
    return (resp, 200) if _ok(r) else (resp, 500)


@app.route("/tor/up", methods=["POST"])
def tor_up():
    nm_con_down(WG_CONN)
    _ = _wait_nm_state_exact(target_absent={WG_CONN}, timeout=60.0)
    r = nm_con_up(TOR_CONN)
    names, settled = _wait_nm_state_exact(target_present={TOR_CONN}, target_absent={WG_CONN}, timeout=60.0)
    resp = jsonify({**_json_from_nm(r), "settled": settled, "active": sorted(names)})
    resp.headers["Cache-Control"] = "no-store"
    return (resp, 200) if _ok(r) else (resp, 500)

@app.route("/tor/down", methods=["POST"])
def tor_down():
    r = nm_con_down(TOR_CONN)
    names, settled = _wait_nm_state_exact(target_absent={TOR_CONN}, timeout=60.0)
    resp = jsonify({**_json_from_nm(r), "settled": settled, "active": sorted(names)})
    resp.headers["Cache-Control"] = "no-store"
    return (resp, 200) if _ok(r) else (resp, 500)


# =========================================
# 12) Routes: Hotspot Controls (Config / Up / Down / Info / Clients)
# =========================================
def _nm_modify_hotspot_ssid(ssid: str):
    return subprocess.run(
        [NMCLI_BIN, "--colors", "no", "con", "mod", HOTSPOT_CONN, "802-11-wireless.ssid", ssid],
        capture_output=True, text=True, env=NM_ENV, timeout=8
    )

def _nm_modify_hotspot_psk(psk: str):
    cmds = [
        [NMCLI_BIN, "--colors", "no", "con", "mod", HOTSPOT_CONN, "802-11-wireless-security.key-mgmt", "wpa-psk"],
        [NMCLI_BIN, "--colors", "no", "con", "mod", HOTSPOT_CONN, "802-11-wireless-security.psk", psk],
    ]
    last = None
    for c in cmds:
        last = subprocess.run(c, capture_output=True, text=True, env=NM_ENV, timeout=8)
        if last.returncode != 0:
            return last
    return last

@app.route("/hotspot/config", methods=["POST"])
def hotspot_config():
    ssid = (request.form.get("ssid") or "").strip()
    password = (request.form.get("password") or "")

    if ssid:
        r = _nm_modify_hotspot_ssid(ssid)
        if r.returncode != 0:
            resp = jsonify(ok=False, **_json_from_nm(r))
            resp.headers["Cache-Control"] = "no-store"
            return resp, 400

    if password:
        if len(password) < 8 or len(password) > 63:
            resp = jsonify(ok=False, error="Password must be 8–63 characters for WPA-PSK")
            resp.headers["Cache-Control"] = "no-store"
            return resp, 400
        r = _nm_modify_hotspot_psk(password)
        if r is None or r.returncode != 0:
            resp = jsonify(ok=False, **(_json_from_nm(r) if r else {"rc": -1, "stderr": "unknown"}))
            resp.headers["Cache-Control"] = "no-store"
            return resp, 400

    resp = jsonify(ok=True)
    resp.headers["Cache-Control"] = "no-store"
    return resp, 200

@app.route("/hotspot/up", methods=["POST"])
def hotspot_up():
    ssid = (request.form.get("ssid") or "").strip()
    password = (request.form.get("password") or "")

    if ssid:
        r = _nm_modify_hotspot_ssid(ssid)
        if r.returncode != 0:
            resp = jsonify(ok=False, **_json_from_nm(r))
            resp.headers["Cache-Control"] = "no-store"
            return resp, 400

    if password:
        if len(password) < 8 or len(password) > 63:
            resp = jsonify(ok=False, error="Password must be 8–63 characters for WPA-PSK")
            resp.headers["Cache-Control"] = "no-store"
            return resp, 400
        r = _nm_modify_hotspot_psk(password)
        if r is None or r.returncode != 0:
            resp = jsonify(ok=False, **(_json_from_nm(r) if r else {"rc": -1, "stderr": "unknown"}))
            resp.headers["Cache-Control"] = "no-store"
            return resp, 400

    r = nm_con_up(HOTSPOT_CONN)
    names, settled = _wait_nm_state_exact(target_present={HOTSPOT_CONN}, timeout=60.0)
    resp = jsonify({**_json_from_nm(r), "settled": settled, "active": sorted(names)})
    resp.headers["Cache-Control"] = "no-store"
    return (resp, 200) if _ok(r) else (resp, 500)

@app.route("/hotspot/down", methods=["POST"])
def hotspot_down():
    r = nm_con_down(HOTSPOT_CONN)
    names, settled = _wait_nm_state_exact(target_absent={HOTSPOT_CONN}, timeout=60.0)
    resp = jsonify({**_json_from_nm(r), "settled": settled, "active": sorted(names)})
    resp.headers["Cache-Control"] = "no-store"
    return (resp, 200) if _ok(r) else (resp, 500)

@app.route("/hotspot/info")
def hotspot_info():
    info = nm_hotspot_info()
    resp = jsonify(info)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp, 200

@app.route("/hotspot/clients")
def hotspot_clients():
    count = count_hotspot_clients()
    resp = jsonify({"count": count})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp, 200


# =========================================
# 13) Server-Side IP & Geolocation Helpers (for Client UI)
# =========================================
@app.route("/server_ip")
def server_ip():
    import urllib.request, urllib.error
    API = "https://check.torproject.org/api/ip"
    timeout = 6.0
    attempts = 2
    ip = None
    err = None
    for _ in range(attempts):
        try:
            req = urllib.request.Request(API)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", "ignore")
                try:
                    data = json.loads(raw)
                    candidate = data.get("IP") or data.get("ip") or ""
                    if isinstance(candidate, str) and candidate.strip():
                        try:
                            addr = ipaddress.ip_address(candidate.strip())
                            if addr.version == 4:
                                ip = str(addr); break
                            else:
                                err = "ipv6 not allowed"; continue
                        except ValueError:
                            err = "invalid ip"; continue
                    else:
                        err = "bad json"
                except Exception:
                    raw = (raw or "").strip()
                    try:
                        addr = ipaddress.ip_address(raw)
                        if addr.version == 4:
                            ip = str(addr); break
                        else:
                            err = "ipv6 not allowed"; continue
                    except Exception:
                        err = "invalid response"
        except urllib.error.URLError as e:
            err = getattr(e, "reason", "request failed")
        except Exception:
            err = "request failed"
        time.sleep(0.4)

    payload = {"ip": ip}
    status = 200 if ip else 502
    resp = jsonify(payload if ip else {"ip": None, "error": err or "unavailable"})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Connection"] = "close"
    return resp, status

@app.route("/server_geo")
def server_geo():
    import urllib.request, urllib.error
    ip = (request.args.get("ip") or "").strip()
    try:
        addr = ipaddress.ip_address(ip)
        if addr.version != 4:
            return jsonify({"error": "ipv6 not allowed"}), 400
    except ValueError:
        return jsonify({"error": "invalid ip"}), 400

    API = f"https://ipapi.co/{ip}/json/"
    timeout = 6.0
    attempts = 2
    last_err = "unavailable"

    for _ in range(attempts):
        try:
            req = urllib.request.Request(API, headers={"User-Agent": "portal/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8", "ignore")
                try:
                    data = json.loads(raw) if raw else {}
                except Exception:
                    data = {}

                city = (data.get("city") or "").strip()
                region = (data.get("region") or data.get("region_code") or "").strip()
                country = (data.get("country_name") or data.get("country") or "").strip()
                org = (data.get("org") or data.get("org_name") or "").strip()
                asn = (data.get("asn") or data.get("as") or "").strip()

                payload = {
                    "city": city or None,
                    "region": region or None,
                    "country": country or None,
                    "org": org or None,
                    "asn": asn or None,
                }
                resp = jsonify(payload)
                resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
                resp.headers["Pragma"] = "no-cache"
                return resp, 200
        except urllib.error.URLError as e:
            last_err = getattr(e, "reason", "request failed")
        except Exception:
            last_err = "request failed"
        time.sleep(0.4)

    resp = jsonify({"error": str(last_err)[:200]})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp, 502


# =========================================
# 14) Route: Hotspot QR (SVG)
# =========================================
@app.route("/hotspot/qr.svg")
def hotspot_qr_svg():
    if segno is None:
        resp = make_response("segno not installed", 503)
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        return resp

    info = nm_hotspot_info()
    ssid = info.get("ssid") or ""
    sec  = (info.get("security") or "").upper()
    psk  = _read_hotspot_psk()

    esc_ssid = _wifi_escape(ssid)
    if sec in {"WPA2", "WPA3"} and psk:
        payload = f"WIFI:T:WPA;S:{esc_ssid};P:{_wifi_escape(psk)};;"
    else:
        payload = f"WIFI:T:nopass;S:{esc_ssid};;"

    # exact QR dark color via query (?c=green -> #22c55e, else red)
    c = (request.args.get("c") or "").strip().lower()
    dark_color = "#22c55e" if c in {"g", "green"} else "#ff0000"

    try:
        q = segno.make(payload, micro=False)
        buf = io.BytesIO()
        q.save(buf, kind="svg", xmldecl=False, border=2, dark=dark_color, light=None)
        svg = buf.getvalue().decode("utf-8", "ignore")
        resp = make_response(svg)
        resp.mimetype = "image/svg+xml"
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        return resp
    except Exception:
        fallback = "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='none'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='monospace' font-size='10'>QR unavailable</text></svg>"
        resp = make_response(fallback)
        resp.mimetype = "image/svg+xml"
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        return resp, 200


# =========================================
# 15) Entrypoint
# =========================================
if __name__ == "__main__":
    app.run(debug=False, host="127.0.0.1", port=5001)
