#!/usr/bin/env bash

set -Eeuo pipefail

# =============================================
# VMM - Virtual Machine Manager
# Script de mise à jour — VMM (Debian/Proxmox)
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/vmm"

# Si on est déjà dans /opt/vmm on l'utilise directement, sinon on cible /opt/vmm
if [ -d "$INSTALL_DIR/.git" ]; then
    WORK_DIR="$INSTALL_DIR"
elif [ -d "$SCRIPT_DIR/.git" ]; then
    WORK_DIR="$SCRIPT_DIR"
else
    err "Répertoire d'installation introuvable ($INSTALL_DIR ou $SCRIPT_DIR)."
    exit 1
fi

COLOR_RED="\033[1;31m"
COLOR_GREEN="\033[1;32m"
COLOR_YELLOW="\033[1;33m"
COLOR_CYAN="\033[1;36m"
COLOR_WHITE="\033[1;37m"
COLOR_GRAY="\033[0;37m"
COLOR_RESET="\033[0m"

log()  { echo -e "${COLOR_CYAN}[+]${COLOR_RESET} $*"; }
ok()   { echo -e "${COLOR_GREEN}[✓]${COLOR_RESET} $*"; }
warn() { echo -e "${COLOR_YELLOW}[!]${COLOR_RESET} $*"; }
err()  { echo -e "${COLOR_RED}[✗]${COLOR_RESET} $*" >&2; }
info() { echo -e "${COLOR_GRAY}[i]${COLOR_RESET} $*"; }

cleanup_on_error() {
    err "Échec de la mise à jour à la ligne $1."
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
echo -e "${COLOR_WHITE}   Virtual Machine Manager — Updater${COLOR_RESET}"
echo ""

# ── Vérification git ──────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
    err "git n'est pas installé."
    warn "  sudo apt install git"
    exit 1
fi

if [ ! -d "$WORK_DIR/.git" ]; then
    err "Ce répertoire n'est pas un dépôt git : $WORK_DIR"
    exit 1
fi
ok "Dépôt git détecté ($WORK_DIR)"

# ── Récupération des changements distants ─────────────────────────────────────
echo ""
log "Récupération des informations depuis le dépôt distant..."
cd "$WORK_DIR"

git fetch origin 2>/dev/null
ok "git fetch effectué"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "")

if [ -z "$REMOTE_HASH" ]; then
    err "Impossible de trouver la branche distante : origin/$CURRENT_BRANCH"
    exit 1
fi

# ── Comparaison local / distant ───────────────────────────────────────────────
echo ""
info "Branche       : $CURRENT_BRANCH"
info "Commit local  : ${LOCAL_HASH:0:8}"
info "Commit distant: ${REMOTE_HASH:0:8}"
echo ""

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    ok "L'application est déjà à jour. Aucune mise à jour nécessaire."
    exit 0
fi

# ── Affichage des commits à appliquer ─────────────────────────────────────────
COMMITS=$(git log --oneline HEAD.."origin/$CURRENT_BRANCH")
COMMIT_COUNT=$(echo "$COMMITS" | grep -c . || true)

log "$COMMIT_COUNT nouveau(x) commit(s) disponible(s) :"
echo ""
echo "$COMMITS" | while IFS= read -r line; do
    echo -e "  ${COLOR_GRAY}•${COLOR_RESET} $line"
done
echo ""

# ── Vérification des fichiers locaux modifiés ─────────────────────────────────
# vmm.conf et *.pem sont exclus du suivi git (.gitignore) — pas de risque
CHANGED=$(git status --porcelain | grep -v "^??" || true)
if [ -n "$CHANGED" ]; then
    warn "Des fichiers locaux ont été modifiés et pourraient créer des conflits :"
    echo "$CHANGED" | while IFS= read -r f; do
        echo -e "  ${COLOR_YELLOW}$f${COLOR_RESET}"
    done
    echo ""
    read -rp "  Continuer malgré tout ? [o/N] " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Oo]$ ]]; then
        warn "Mise à jour annulée."
        exit 0
    fi
fi

# ── Application de la mise à jour ─────────────────────────────────────────────
log "Application de la mise à jour..."
git pull origin "$CURRENT_BRANCH"
echo ""
ok "Mise à jour appliquée ($(git rev-parse --short HEAD))"

# ── Mise à jour des dépendances npm si package.json a changé ──────────────────
if git diff HEAD~"$COMMIT_COUNT" HEAD -- package.json &>/dev/null | grep -q .; then
    echo ""
    log "package.json a changé — mise à jour des dépendances npm..."
    npm install
    ok "Dépendances npm mises à jour"
fi

chmod +x update.sh

# ── Résumé ────────────────────────────────────────────────────────────────────
echo ""
# ── Redémarrage pm2 ───────────────────────────────────────────────────────────
if command -v pm2 &>/dev/null && pm2 describe VMM &>/dev/null; then
    log "Redémarrage de VMM via pm2..."
    pm2 restart VMM
    ok "VMM redémarré"
else
    warn "pm2 non détecté ou VMM non enregistré — redémarrez manuellement."
fi

echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
ok "VMM est à jour !"
echo ""
echo -e "  ${COLOR_WHITE}Gérer l'application :${COLOR_RESET}"
echo -e "  ${COLOR_CYAN}  pm2 status${COLOR_RESET}           — état"
echo -e "  ${COLOR_CYAN}  pm2 logs VMM${COLOR_RESET}         — logs en direct"
echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
