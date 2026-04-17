#!/usr/bin/env bash

set -Eeuo pipefail

# =============================================
# VMM - Virtual Machine Manager
# Installation script — VMM (Debian/Proxmox)
# ============================================================

INSTALL_DIR="/opt/vmm"
SCRIPT_SELF="$(realpath "${BASH_SOURCE[0]}")"

COLOR_RED="\033[1;31m"
COLOR_GREEN="\033[1;32m"
COLOR_YELLOW="\033[1;33m"
COLOR_CYAN="\033[1;36m"
COLOR_WHITE="\033[1;37m"
COLOR_RESET="\033[0m"

log()  { echo -e "${COLOR_CYAN}[+]${COLOR_RESET} $*"; }
ok()   { echo -e "${COLOR_GREEN}[✓]${COLOR_RESET} $*"; }
warn() { echo -e "${COLOR_YELLOW}[!]${COLOR_RESET} $*"; }
err()  { echo -e "${COLOR_RED}[✗]${COLOR_RESET} $*" >&2; }

cleanup_on_error() {
    err "Installation failed at line $1."
    exit 1
}
trap 'cleanup_on_error $LINENO' ERR

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${COLOR_CYAN}"
echo "  ██╗   ██╗███╗   ███╗███╗   ███╗"
echo "  ██║   ██║████╗ ████║████╗ ████║"
echo "  ██║   ██║██╔████╔██║██╔████╔██║"
echo "  ╚██╗ ██╔╝██║╚██╔╝██║██║╚██╔╝██║"
echo "   ╚████╔╝ ██║ ╚═╝ ██║██║ ╚═╝ ██║"
echo "    ╚═══╝  ╚═╝     ╚═╝╚═╝     ╚═╝"
echo -e "${COLOR_WHITE}   Virtual Machine Manager — Installer${COLOR_RESET}"
echo ""

# ── Prerequisites installation ───────────────────────────────────────────────
log "Checking and installing prerequisites..."

# git
if ! command -v git &>/dev/null; then
    log "Installing git..."
    apt-get update -qq
    apt-get install -y git
fi
ok "git $(git --version | awk '{print $3}') detected"

# OpenSSL
if ! command -v openssl &>/dev/null; then
    log "Installing OpenSSL..."
    apt-get install -y openssl
fi
ok "$(openssl version) detected"

# Node.js + npm
if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
    log "Installing Node.js and npm..."
    apt-get update -qq
    apt-get install -y nodejs npm
fi
ok "Node.js $(node --version) / npm v$(npm --version) detected"

# pm2
if ! command -v pm2 &>/dev/null; then
    log "Installing pm2..."
    npm install -g pm2
fi
ok "pm2 $(pm2 --version) detected"
echo ""

# ── Cloning into /opt/vmm ───────────────────────────────────────────────────
log "Deploying VMM into $INSTALL_DIR..."

if [ -d "$INSTALL_DIR/.git" ]; then
    warn "$INSTALL_DIR already exists, updating code..."
    git -C "$INSTALL_DIR" pull origin main
else
    git clone https://github.com/R3coNYT/VMM.git "$INSTALL_DIR"
fi
ok "Code deployed in $INSTALL_DIR"

# ── Network interface detection ──────────────────────────────────────────────
log "Retrieving available network interfaces..."
echo ""

declare -a IFACE_NAMES
declare -a IFACE_IPS
count=0

while IFS= read -r iface; do
    iface=$(echo "$iface" | sed 's/://g')
    ip=$(ip -4 addr show "$iface" 2>/dev/null \
         | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || true)
    if [[ -n "$ip" && "$iface" != "lo" ]]; then
        IFACE_NAMES[$count]="$iface"
        IFACE_IPS[$count]="$ip"
        echo -e "  ${COLOR_CYAN}[$((count+1))]${COLOR_RESET} ${COLOR_WHITE}$iface${COLOR_RESET} — $ip"
        count=$((count + 1))
    fi
done < <(ip link show up | awk -F': ' '/^[0-9]+:/{print $2}')

if [ "$count" -eq 0 ]; then
    err "No active network interface with an IPv4 address found."
    exit 1
fi

echo ""
CHOICE=""
while true; do
    read -rp "  Choose an interface (1-$count): " CHOICE
    if [[ "$CHOICE" =~ ^[0-9]+$ ]] && \
       [ "$CHOICE" -ge 1 ] && [ "$CHOICE" -le "$count" ]; then
        break
    fi
    warn "Invalid choice, try again."
done

IDX=$(( CHOICE - 1 ))
SELECTED_IP="${IFACE_IPS[$IDX]}"
SELECTED_NAME="${IFACE_NAMES[$IDX]}"

echo ""
ok "Selected interface: ${COLOR_WHITE}$SELECTED_NAME${COLOR_RESET} (${COLOR_CYAN}$SELECTED_IP${COLOR_RESET})"

# ── Writing vmm.conf ─────────────────────────────────────────────────────────
echo ""
log "Writing configuration to $INSTALL_DIR/vmm.conf..."

CONF_PATH="$INSTALL_DIR/vmm.conf"

cat > "$CONF_PATH" <<EOF
# VMM - Virtual Machine Manager
# Configuration generated on $(date '+%Y-%m-%d %H:%M:%S')

# IP address of the Proxmox host machine
IP=$SELECTED_IP

# HTTPS port for the web interface
PORT=4000
EOF

ok "vmm.conf created → IP=$SELECTED_IP"

# ── SSL certificate generation ────────────────────────────────────────────────
echo ""
log "Generating self-signed SSL certificates..."

CERT_PATH="$INSTALL_DIR/cert.pem"
KEY_PATH="$INSTALL_DIR/key.pem"
CONFIG_TMP=$(mktemp)

cat > "$CONFIG_TMP" <<EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions    = v3_req
prompt             = no

[req_distinguished_name]
CN = $SELECTED_IP

[v3_req]
keyUsage         = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @alt_names

[alt_names]
IP.1 = $SELECTED_IP
EOF

if openssl req -x509 -newkey rsa:4096 \
    -keyout "$KEY_PATH" \
    -out    "$CERT_PATH" \
    -days 365 -nodes \
    -config "$CONFIG_TMP" 2>&1 | grep -v "^writing\|Generating"; then
    rm -f "$CONFIG_TMP"
    ok "SSL certificates generated: key.pem, cert.pem (365 days, RSA 4096)"
else
    rm -f "$CONFIG_TMP"
    err "SSL certificate generation failed."
    exit 1
fi

# ── npm dependencies installation ─────────────────────────────────────────────
echo ""
log "Installing npm dependencies..."
cd "$INSTALL_DIR"
npm install

# ── Launch with pm2 ───────────────────────────────────────────────────────────
echo ""
log "Starting the application with pm2..."

# If a VMM instance is already running restart it, otherwise start fresh
if pm2 describe VMM &>/dev/null; then
    pm2 restart VMM
    ok "VMM restarted via pm2"
else
    pm2 start "$INSTALL_DIR/app.js" --name VMM
    ok "VMM started via pm2"
fi

# Save pm2 list for automatic restart on boot
pm2 save
log "Enabling automatic startup on boot (pm2 startup)..."
pm2 startup systemd -u root --hp /root | tail -1 | bash || \
    warn "pm2 startup: run the displayed command manually if needed."
echo ""

chmod +x "$INSTALL_DIR/update.sh"

# ── Cleanup — remove installation script ─────────────────────────────────────
if [ "$SCRIPT_SELF" != "$INSTALL_DIR/install.sh" ]; then
    rm -f "$SCRIPT_SELF"
    ok "install.sh removed"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
ok "Installation completed successfully!"
echo ""
echo -e "  ${COLOR_WHITE}Manage the application:${COLOR_RESET}"
echo -e "  ${COLOR_CYAN}  pm2 status${COLOR_RESET}           — status"
echo -e "  ${COLOR_CYAN}  pm2 logs VMM${COLOR_RESET}         — live logs"
echo -e "  ${COLOR_CYAN}  pm2 restart VMM${COLOR_RESET}      — restart"
echo -e "  ${COLOR_CYAN}  pm2 stop VMM${COLOR_RESET}         — stop"
echo ""
echo -e "  ${COLOR_WHITE}HTTPS interface:${COLOR_RESET}"
echo -e "  ${COLOR_CYAN}  https://$SELECTED_IP:4000${COLOR_RESET}"
echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
