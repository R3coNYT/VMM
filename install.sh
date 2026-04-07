#!/usr/bin/env bash

set -Eeuo pipefail

# =============================================
# VMM - Virtual Machine Manager
# Script d'installation — proxmox_nodejs (Debian/Proxmox)
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
    err "Échec de l'installation à la ligne $1."
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

# ── Vérification des prérequis ────────────────────────────────────────────────
log "Vérification des prérequis..."

if ! command -v node &>/dev/null; then
    err "Node.js n'est pas installé."
    warn "  sudo apt install nodejs npm"
    exit 1
fi
ok "Node.js $(node --version) détecté"

if ! command -v npm &>/dev/null; then
    err "npm n'est pas disponible."
    exit 1
fi
ok "npm v$(npm --version) détecté"

if ! command -v openssl &>/dev/null; then
    err "OpenSSL n'est pas installé."
    warn "  sudo apt install openssl"
    exit 1
fi
ok "$(openssl version) détecté"
echo ""

# ── Détection des interfaces réseau ──────────────────────────────────────────
log "Récupération des interfaces réseau disponibles..."
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
    err "Aucune interface réseau active avec une adresse IPv4 trouvée."
    exit 1
fi

echo ""
CHOICE=""
while true; do
    read -rp "  Choisissez une interface (1-$count) : " CHOICE
    if [[ "$CHOICE" =~ ^[0-9]+$ ]] && \
       [ "$CHOICE" -ge 1 ] && [ "$CHOICE" -le "$count" ]; then
        break
    fi
    warn "Choix invalide, réessayez."
done

IDX=$(( CHOICE - 1 ))
SELECTED_IP="${IFACE_IPS[$IDX]}"
SELECTED_NAME="${IFACE_NAMES[$IDX]}"

echo ""
ok "Interface sélectionnée : ${COLOR_WHITE}$SELECTED_NAME${COLOR_RESET} (${COLOR_CYAN}$SELECTED_IP${COLOR_RESET})"

# ── Écriture de vmm.conf ─────────────────────────────────────────────────────
echo ""
log "Écriture de la configuration dans vmm.conf..."

CONF_PATH="$SCRIPT_DIR/vmm.conf"

cat > "$CONF_PATH" <<EOF
# VMM - Virtual Machine Manager
# Configuration générée le $(date '+%Y-%m-%d %H:%M:%S')

# Adresse IP de la machine hôte Proxmox
IP=$SELECTED_IP

# Port HTTPS de l'interface web
PORT=4000
EOF

ok "vmm.conf créé → IP=$SELECTED_IP"

# ── Génération des certificats SSL ────────────────────────────────────────────
echo ""
log "Génération des certificats SSL auto-signés..."

CERT_PATH="$SCRIPT_DIR/cert.pem"
KEY_PATH="$SCRIPT_DIR/key.pem"
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
    ok "Certificats SSL générés : key.pem, cert.pem (365 jours, RSA 4096)"
else
    rm -f "$CONFIG_TMP"
    err "Échec de la génération des certificats SSL."
    exit 1
fi

# ── Installation des dépendances npm ─────────────────────────────────────────
echo ""
log "Installation des dépendances npm..."
cd "$SCRIPT_DIR"
npm install
echo ""

# ── Résumé ────────────────────────────────────────────────────────────────────
echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
ok "Installation terminée avec succès !"
echo ""
echo -e "  ${COLOR_WHITE}Pour lancer l'application :${COLOR_RESET}"
echo -e "  ${COLOR_CYAN}  node app.js${COLOR_RESET}"
echo ""
echo -e "  ${COLOR_WHITE}Interface HTTPS :${COLOR_RESET}"
echo -e "  ${COLOR_CYAN}  https://$SELECTED_IP:4000${COLOR_RESET}"
echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
