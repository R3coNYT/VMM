#!/usr/bin/env bash

set -Eeuo pipefail

# =============================================
# VMM - Virtual Machine Manager
# Script d'installation — proxmox_nodejs (Debian/Proxmox)
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

# ── Installation des prérequis ───────────────────────────────────────────────
log "Vérification et installation des prérequis..."

# git
if ! command -v git &>/dev/null; then
    log "Installation de git..."
    apt-get update -qq
    apt-get install -y git
fi
ok "git $(git --version | awk '{print $3}') détecté"

# OpenSSL
if ! command -v openssl &>/dev/null; then
    log "Installation d'OpenSSL..."
    apt-get install -y openssl
fi
ok "$(openssl version) détecté"

# Node.js + npm
if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
    log "Installation de Node.js et npm..."
    apt-get update -qq
    apt-get install -y nodejs npm
fi
ok "Node.js $(node --version) / npm v$(npm --version) détectés"

# pm2
if ! command -v pm2 &>/dev/null; then
    log "Installation de pm2..."
    npm install -g pm2
fi
ok "pm2 $(pm2 --version) détecté"
echo ""

# ── Clonage dans /opt/vmm ───────────────────────────────────────────────────
log "Déploiement de VMM dans $INSTALL_DIR..."

if [ -d "$INSTALL_DIR/.git" ]; then
    warn "$INSTALL_DIR existe déjà, mise à jour du code..."
    git -C "$INSTALL_DIR" pull origin main
else
    git clone https://github.com/R3coNYT/VMM.git "$INSTALL_DIR"
fi
ok "Code déployé dans $INSTALL_DIR"

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
log "Écriture de la configuration dans $INSTALL_DIR/vmm.conf..."

CONF_PATH="$INSTALL_DIR/vmm.conf"

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
    ok "Certificats SSL générés : key.pem, cert.pem (365 jours, RSA 4096)"
else
    rm -f "$CONFIG_TMP"
    err "Échec de la génération des certificats SSL."
    exit 1
fi

# ── Installation des dépendances npm ─────────────────────────────────────────
echo ""
log "Installation des dépendances npm..."
cd "$INSTALL_DIR"
npm install

# ── Lancement avec pm2 ───────────────────────────────────────────────────────
echo ""
log "Lancement de l'application avec pm2..."

# Si une instance VMM tourne déjà on la redémarre, sinon on démarre
if pm2 describe VMM &>/dev/null; then
    pm2 restart VMM
    ok "VMM redémarré via pm2"
else
    pm2 start "$INSTALL_DIR/app.js" --name VMM
    ok "VMM démarré via pm2"
fi

# Sauvegarde de la liste pm2 pour redémarrage automatique au boot
pm2 save
log "Activation du démarrage automatique au boot (pm2 startup)..."
pm2 startup systemd -u root --hp /root | tail -1 | bash || \
    warn "Commande pm2 startup : lancez manuellement la commande affichée ci-dessus si nécessaire."
echo ""

chmod +x "$INSTALL_DIR/update.sh"

# ── Nettoyage — suppression du script d'installation ─────────────────────────
if [ "$SCRIPT_SELF" != "$INSTALL_DIR/install.sh" ]; then
    rm -f "$SCRIPT_SELF"
    ok "install.sh supprimé"
fi

# ── Résumé ────────────────────────────────────────────────────────────────────
echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
ok "Installation terminée avec succès !"
echo ""
echo -e "  ${COLOR_WHITE}Gérer l'application :${COLOR_RESET}"
echo -e "  ${COLOR_CYAN}  pm2 status${COLOR_RESET}           — état"
echo -e "  ${COLOR_CYAN}  pm2 logs VMM${COLOR_RESET}         — logs en direct"
echo -e "  ${COLOR_CYAN}  pm2 restart VMM${COLOR_RESET}      — redémarrer"
echo -e "  ${COLOR_CYAN}  pm2 stop VMM${COLOR_RESET}         — arrêter"
echo ""
echo -e "  ${COLOR_WHITE}Interface HTTPS :${COLOR_RESET}"
echo -e "  ${COLOR_CYAN}  https://$SELECTED_IP:4000${COLOR_RESET}"
echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
