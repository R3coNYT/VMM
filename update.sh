#!/usr/bin/env bash

set -Eeuo pipefail

# =============================================
# VMM - Virtual Machine Manager
# Update script — VMM (Debian/Proxmox)
# =============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/vmm"

# If already in /opt/vmm use it directly, otherwise target /opt/vmm
if [ -d "$INSTALL_DIR/.git" ]; then
    WORK_DIR="$INSTALL_DIR"
elif [ -d "$SCRIPT_DIR/.git" ]; then
    WORK_DIR="$SCRIPT_DIR"
else
    err "Installation directory not found ($INSTALL_DIR or $SCRIPT_DIR)."
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
    err "Update failed at line $1."
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

# ── Git check ────────────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
    err "git is not installed."
    warn "  sudo apt install git"
    exit 1
fi

if [ ! -d "$WORK_DIR/.git" ]; then
    err "This directory is not a git repository: $WORK_DIR"
    exit 1
fi
ok "Git repository detected ($WORK_DIR)"

# ── Fetching remote changes ──────────────────────────────────────────────────
echo ""
log "Fetching information from the remote repository..."
cd "$WORK_DIR"

git fetch origin 2>/dev/null
ok "git fetch done"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "")

if [ -z "$REMOTE_HASH" ]; then
    err "Could not find remote branch: origin/$CURRENT_BRANCH"
    exit 1
fi

# ── Local / remote comparison ───────────────────────────────────────────────
echo ""
info "Branch        : $CURRENT_BRANCH"
info "Local commit  : ${LOCAL_HASH:0:8}"
info "Remote commit : ${REMOTE_HASH:0:8}"
echo ""

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    ok "Application is already up to date. No update needed."
    exit 0
fi

# ── Displaying commits to apply ──────────────────────────────────────────────
COMMITS=$(git log --oneline HEAD.."origin/$CURRENT_BRANCH")
COMMIT_COUNT=$(echo "$COMMITS" | grep -c . || true)

log "$COMMIT_COUNT new commit(s) available:"
echo ""
echo "$COMMITS" | while IFS= read -r line; do
    echo -e "  ${COLOR_GRAY}•${COLOR_RESET} $line"
done
echo ""

# ── Checking locally modified files ──────────────────────────────────────────
# vmm.conf and *.pem are excluded from git tracking (.gitignore) — no risk
CHANGED=$(git status --porcelain | grep -v "^??" || true)
if [ -n "$CHANGED" ]; then
    warn "Some local files have been modified and could cause conflicts:"
    echo "$CHANGED" | while IFS= read -r f; do
        echo -e "  ${COLOR_YELLOW}$f${COLOR_RESET}"
    done
    echo ""
    read -rp "  Continue anyway? [y/N] " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        warn "Update cancelled."
        exit 0
    fi
fi

# ── Applying the update ─────────────────────────────────────────────────────
log "Applying the update..."
git pull origin "$CURRENT_BRANCH"
echo ""
ok "Update applied ($(git rev-parse --short HEAD))"

# ── Update npm dependencies if package.json changed ─────────────────────────
if git diff HEAD~"$COMMIT_COUNT" HEAD -- package.json &>/dev/null | grep -q .; then
    echo ""
    log "package.json changed — updating npm dependencies..."
    npm install
    ok "npm dependencies updated"
fi

chmod +x update.sh

# ── Résumé ────────────────────────────────────────────────────────────────────
echo ""
# ── pm2 restart ──────────────────────────────────────────────────────────────
if command -v pm2 &>/dev/null && pm2 describe VMM &>/dev/null; then
    log "Restarting VMM via pm2..."
    pm2 restart VMM
    ok "VMM restarted"
else
    warn "pm2 not detected or VMM not registered — restart manually."
fi

echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
ok "VMM is up to date!"
echo ""
echo -e "  ${COLOR_WHITE}Manage the application:${COLOR_RESET}"
echo -e "  ${COLOR_CYAN}  pm2 status${COLOR_RESET}           — status"
echo -e "  ${COLOR_CYAN}  pm2 logs VMM${COLOR_RESET}         — live logs"
echo -e "${COLOR_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
