#!/usr/bin/env bash
set -euo pipefail

# Ident Agency CLI installer script
# Usage: curl -fsSL https://get.ident.agency/install.sh | sh

OWNER="LoremLabs"
REPO="identa-cli"
NAME="identa"

# Detect platform
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Linux)   os="linux" ;;
  Darwin)  os="darwin" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

TARGET="${os}-${arch}"

# Get latest tag
TAG=$(curl -fsSL "https://api.github.com/repos/$OWNER/$REPO/releases/latest" | \
      grep -m1 '"tag_name":' | sed -E 's/.*"v?([^"]+)".*/\1/')

ASSET="${NAME}-${TARGET}"
[[ "$os" == "win" ]] && ASSET="${ASSET}.exe"

URL="https://github.com/$OWNER/$REPO/releases/download/v${TAG}/${ASSET}"
SUM_URL="${URL}.sha256"

echo "Downloading ${ASSET} (v${TAG})..."
curl -fsSL -o "${ASSET}" "${URL}"
curl -fsSL -o "${ASSET}.sha256" "${SUM_URL}"

echo "Verifying checksum..."
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c <(awk '{print $1"  '"${ASSET}"'"}' "${ASSET}.sha256")
else
  sha256sum -c <(awk '{print $1"  '"${ASSET}"'"}' "${ASSET}.sha256")
fi

chmod +x "${ASSET}"
rm -f "${ASSET}.sha256"

echo "✅ Installed ${NAME} v${TAG}"
${NAME} --version
