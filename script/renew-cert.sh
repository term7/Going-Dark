#!/bin/bash
set -euo pipefail

# Where to store the log (overwrite on each run)
LOG_FILE="/home/admin/script/SSL/renewal.log"
: > "$LOG_FILE"  # truncate at start

# ----- Timestamp every log line -----
if command -v ts >/dev/null 2>&1; then
  exec > >(ts "[%Y-%m-%d %H:%M:%S]" >> "$LOG_FILE") 2>&1
else
  exec > >(awk '{ print strftime("[%Y-%m-%d %H:%M:%S]"), $0; fflush(); }' >> "$LOG_FILE") 2>&1
fi

# ----- Config -----
CA_DIR="/home/admin/tools/CA"
SSL_DIR="$CA_DIR/SSL"
CA_CERT="$CA_DIR/term7-CA.pem"
CA_KEY="$CA_DIR/term7-CA.key"
CA_SERIAL="$CA_DIR/term7-CA.srl"
DAYS=825
DOMAINS=("adguard.home" "going.dark")
RESTART_SERVICES=("nginx" "AdGuardHome")

# --- Renewal loop ---
for DOMAIN in "${DOMAINS[@]}"; do
  CNF_FILE="$SSL_DIR/openssl-${DOMAIN//./}.cnf"
  CRT_FILE="$SSL_DIR/$DOMAIN.crt"
  KEY_FILE="$SSL_DIR/$DOMAIN.key"
  CSR_FILE="$SSL_DIR/$DOMAIN.csr"
  FULLCHAIN="$SSL_DIR/$DOMAIN-fullchain.crt"

  if [ ! -f "$CRT_FILE" ]; then
    DAYS_LEFT=0
  else
    ENDLINE="$(openssl x509 -enddate -noout -in "$CRT_FILE" 2>/dev/null || true)"
    if [[ "$ENDLINE" =~ ^notAfter= ]]; then
      EXPIRY_RAW="${ENDLINE#notAfter=}"
      EXPIRY_EPOCH=$(date -d "$EXPIRY_RAW" +%s)
      NOW_EPOCH=$(date +%s)
      SECS_LEFT=$(( EXPIRY_EPOCH - NOW_EPOCH ))
      DAYS_LEFT=$(( SECS_LEFT > 0 ? SECS_LEFT / 86400 : 0 ))
    else
      DAYS_LEFT=0
    fi
  fi

  if [ "$DAYS_LEFT" -gt 30 ]; then
    echo "$DOMAIN: certificate expiring in $DAYS_LEFT days — not renewing."
    continue
  else
    echo "$DOMAIN: certificate expiring in $DAYS_LEFT days — renewing..."
  fi

  openssl req -new -key "$KEY_FILE" -out "$CSR_FILE" -config "$CNF_FILE"
  openssl x509 -req \
    -in "$CSR_FILE" \
    -CA "$CA_CERT" -CAkey "$CA_KEY" \
    -CAserial "$CA_SERIAL" -CAcreateserial \
    -out "$CRT_FILE" \
    -days "$DAYS" \
    -extensions v3_req -extfile "$CNF_FILE"

  cat "$CRT_FILE" "$CA_CERT" > "$FULLCHAIN"

  NEW_END="$(openssl x509 -in "$CRT_FILE" -noout -enddate | sed 's/^notAfter=//')"
  echo "$DOMAIN: new certificate expires on $NEW_END"
done

# --- Restart services ---
for svc in "${RESTART_SERVICES[@]}"; do
  if systemctl is-enabled "$svc" >/dev/null 2>&1 || systemctl is-active "$svc" >/dev/null 2>&1; then
    sudo systemctl restart "$svc"
  fi
done