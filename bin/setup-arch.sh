#!/usr/bin/env bash
# Copyright 2026 Dave LeBlanc
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step()  { echo -e "\n${BOLD}==> $1${NC}"; }

# Resolve repo root regardless of where the script is called from
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Sanity checks ────────────────────────────────────────────────────────────

step "Checking environment"

if ! command -v pacman &>/dev/null; then
  error "pacman not found — this script targets Arch Linux only."
fi

if [[ $EUID -eq 0 ]]; then
  error "Do not run this script as root. sudo will be invoked where needed."
fi

# ── System packages ──────────────────────────────────────────────────────────

step "Refreshing keyring and upgrading system"
# Keyring must be current before any other packages can be verified.
# Full -Syu is required on Arch before installing individual packages — partial
# upgrades break ABI (e.g. the gcc-libs → libgcc/libstdc++ split causes
# "conflicting files" errors if the system isn't fully up to date first).
sudo pacman -Sy --noconfirm archlinux-keyring
sudo pacman-key --populate archlinux
sudo pacman -Su --noconfirm

step "Installing system packages"
# git, curl, unzip: toolchain essentials
# nodejs, npm: JS runtime (Arch ships the latest stable)
# pnpm: workspace package manager used by this project
sudo pacman -S --needed --noconfirm git curl unzip nodejs npm pnpm

# Verify Node.js meets the minimum required version (22+)
NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if (( NODE_MAJOR < 22 )); then
  warn "Arch's packaged Node.js is v$(node --version | sed 's/v//') — this project requires 22+."
  warn "Install nvm to manage Node versions: https://github.com/nvm-sh/nvm"
  warn "  nvm install 22 && nvm use 22"
  error "Aborting: Node.js 22+ is required."
fi
info "Node.js $(node --version) — OK"

# Verify pnpm meets the minimum required version (9+)
PNPM_MAJOR=$(pnpm --version | cut -d. -f1)
if (( PNPM_MAJOR < 9 )); then
  error "pnpm $(pnpm --version) found — this project requires pnpm 9+. Run: npm install -g pnpm@latest"
fi
info "pnpm $(pnpm --version) — OK"

# ── AWS CLI v2 ───────────────────────────────────────────────────────────────

step "Installing AWS CLI v2"

if command -v aws &>/dev/null; then
  AWS_MAJOR=$(aws --version 2>&1 | grep -oP 'aws-cli/\K[0-9]+' || echo "0")
  if (( AWS_MAJOR >= 2 )); then
    info "AWS CLI $(aws --version 2>&1 | grep -oP 'aws-cli/\K[^ ]+') already installed — skipping"
  else
    warn "AWS CLI v1 detected — please upgrade to v2 manually."
    warn "  Uninstall v1, then re-run this script."
  fi
else
  # Prefer an AUR helper if available; otherwise use the official binary installer
  if command -v paru &>/dev/null; then
    info "Using paru to install aws-cli-v2 from AUR"
    paru -S --needed --noconfirm aws-cli-v2
  elif command -v yay &>/dev/null; then
    info "Using yay to install aws-cli-v2 from AUR"
    yay -S --needed --noconfirm aws-cli-v2
  else
    info "No AUR helper found — installing AWS CLI v2 via official binary installer"
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "$TMP_DIR/awscliv2.zip"
    unzip -q "$TMP_DIR/awscliv2.zip" -d "$TMP_DIR"
    sudo "$TMP_DIR/aws/install" --update
  fi
  info "AWS CLI $(aws --version 2>&1 | grep -oP 'aws-cli/\K[^ ]+') — OK"
fi

# ── Project dependencies ─────────────────────────────────────────────────────

step "Installing project npm dependencies"
cd "$REPO_ROOT"
pnpm install

# Guard: pnpm install can exit 0 on partial failure (e.g. optional dep errors)
# without creating node_modules, which causes a cryptic "tsc: command not found"
# when the build step runs next.
if [[ ! -x "$REPO_ROOT/node_modules/.bin/tsc" ]]; then
  error "pnpm install completed but tsc was not installed — check the output above for errors, then re-run this script."
fi

step "Building shared types package"
pnpm --filter @simmerplan/types build

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Configure AWS CLI profiles:"
echo "       aws configure --profile simmerplan-sandbox"
echo "       aws configure --profile simmerplan-prod"
echo ""
echo "  2. Scaffold the DynamoDB table (sandbox):"
echo "       pnpm scaffold:db"
echo ""
echo "  3. Start the mobile app:"
echo "       pnpm --filter @simmerplan/mobile start"
echo ""
echo "  4. Build Lambda functions:"
echo "       pnpm --filter @simmerplan/api build"
