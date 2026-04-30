#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NODE_MAJOR="${CODE8_NODE_MAJOR:-24}"
NODE_VERSION="${CODE8_NODE_VERSION:-}"
NODE_ARCH="${CODE8_NODE_ARCH:-}"
TOOLS_DIR="${CODE8_TOOLS_DIR:-$HOME/workspace/tools}"
CACHE_DIR="$TOOLS_DIR/cache"
GRPC_TOOLS_VERSION="${CODE8_GRPC_TOOLS_VERSION:-1.13.1}"
RIPGREP_VERSION="${CODE8_RIPGREP_VERSION:-v15.0.0}"
VSCODE_RIPGREP_PACKAGE_VERSION="${CODE8_VSCODE_RIPGREP_PACKAGE_VERSION:-1.17.0}"

log() {
	printf >&2 '\n==> %s\n' "$*"
}

retry() {
	local attempts="$1"
	shift
	local delay=8
	local n=1
	while true; do
		if "$@"; then
			return 0
		fi
		if [ "$n" -ge "$attempts" ]; then
			return 1
		fi
		log "Retry $n/$attempts failed; sleeping ${delay}s"
		sleep "$delay"
		n=$((n + 1))
		delay=$((delay * 2))
	done
}

detect_arch() {
	case "$(uname -m)" in
		x86_64 | amd64)
			printf 'linux-x64'
			;;
		aarch64 | arm64)
			printf 'linux-arm64'
			;;
		*)
			printf >&2 'Unsupported architecture: %s\n' "$(uname -m)"
			exit 1
			;;
	esac
}

detect_ripgrep_target() {
	case "$NODE_ARCH" in
		linux-x64)
			printf 'x86_64-unknown-linux-musl'
			;;
		linux-arm64)
			printf 'aarch64-unknown-linux-musl'
			;;
		*)
			printf >&2 'Unsupported ripgrep target for architecture: %s\n' "$NODE_ARCH"
			exit 1
			;;
	esac
}

resolve_node_version() {
	python3 - "$NODE_MAJOR" <<'PY'
import json
import sys
import urllib.request

major = sys.argv[1]
with urllib.request.urlopen("https://nodejs.org/dist/index.json", timeout=30) as response:
    releases = json.load(response)

versions = [
    item["version"]
    for item in releases
    if item.get("version", "").startswith(f"v{major}.")
]
if not versions:
    raise SystemExit(f"No Node.js release found for major {major}")

def key(version):
    return tuple(int(part) for part in version.lstrip("v").split("."))

print(sorted(versions, key=key)[-1])
PY
}

install_node() {
	if [ -z "$NODE_ARCH" ]; then
		NODE_ARCH="$(detect_arch)"
	fi
	if [ -z "$NODE_VERSION" ]; then
		log "Resolving latest Node.js v${NODE_MAJOR}.x release"
		NODE_VERSION="$(retry 4 resolve_node_version)"
	fi

	local node_name="node-${NODE_VERSION}-${NODE_ARCH}"
	local node_root="$TOOLS_DIR/$node_name"
	local tarball="$CACHE_DIR/$node_name.tar.xz"
	local shasums="$CACHE_DIR/SHASUMS256-${NODE_VERSION}.txt"
	local base_url="https://nodejs.org/dist/${NODE_VERSION}"

	mkdir -p "$CACHE_DIR" "$TOOLS_DIR"

	if [ ! -x "$node_root/bin/node" ]; then
		log "Installing $node_name into $TOOLS_DIR"
		if [ ! -f "$tarball" ]; then
			retry 4 curl -fL --retry 3 --retry-delay 5 --connect-timeout 20 -o "$tarball" "$base_url/$node_name.tar.xz"
		else
			log "Using cached $tarball"
		fi
		if [ ! -f "$shasums" ]; then
			retry 4 curl -fL --retry 3 --retry-delay 5 --connect-timeout 20 -o "$shasums" "$base_url/SHASUMS256.txt"
		else
			log "Using cached $shasums"
		fi
		(cd "$CACHE_DIR" && grep " $node_name.tar.xz\$" "SHASUMS256-${NODE_VERSION}.txt" | sha256sum -c -)
		rm -rf "$node_root"
		tar -xJf "$tarball" -C "$TOOLS_DIR"
	fi

	export PATH="$node_root/bin:$PATH"
	export npm_config_nodedir="$node_root"
	log "Using Node $(node --version) and npm $(npm --version)"
}

build_vsix() {
	if [ -z "${CODE8_GRPC_TOOLS_BINARY_HOST_MIRROR:-}" ]; then
		local grpc_tarball="$CACHE_DIR/grpc-tools/v${GRPC_TOOLS_VERSION}/${NODE_ARCH}.tar.gz"
		local grpc_url="https://node-precompiled-binaries.grpc.io/grpc-tools/v${GRPC_TOOLS_VERSION}/${NODE_ARCH}.tar.gz"
		mkdir -p "$(dirname "$grpc_tarball")"
		if [ ! -f "$grpc_tarball" ]; then
			log "Caching grpc-tools v${GRPC_TOOLS_VERSION} ${NODE_ARCH} binary"
			retry 4 curl -fL --retry 3 --retry-delay 5 --connect-timeout 20 -o "$grpc_tarball" "$grpc_url"
		else
			log "Using cached $grpc_tarball"
		fi
		export npm_config_grpc_tools_binary_host_mirror="file://$CACHE_DIR/"
	else
		export npm_config_grpc_tools_binary_host_mirror="$CODE8_GRPC_TOOLS_BINARY_HOST_MIRROR"
	fi
	log "Using grpc-tools binary mirror $npm_config_grpc_tools_binary_host_mirror"

	local ripgrep_target
	ripgrep_target="$(detect_ripgrep_target)"
	local ripgrep_asset="ripgrep-${RIPGREP_VERSION}-${ripgrep_target}.tar.gz"
	local ripgrep_cache="${TMPDIR:-/tmp}/vscode-ripgrep-cache-${VSCODE_RIPGREP_PACKAGE_VERSION}"
	local ripgrep_tarball="$ripgrep_cache/$ripgrep_asset"
	local ripgrep_url="https://github.com/microsoft/ripgrep-prebuilt/releases/download/${RIPGREP_VERSION}/${ripgrep_asset}"
	mkdir -p "$ripgrep_cache"
	if [ ! -f "$ripgrep_tarball" ]; then
		log "Caching $ripgrep_asset"
		retry 4 curl -fL --retry 3 --retry-delay 5 --connect-timeout 20 -o "$ripgrep_tarball" "$ripgrep_url"
	else
		log "Using cached $ripgrep_tarball"
	fi

	log "Installing root dependencies"
	retry 4 npm install

	log "Installing webview dependencies"
	retry 4 npm --prefix webview-ui install

	log "Building VSIX"
	npm run package:vsix

	log "Built artifacts"
	ls -lh code8-*.vsix dist/*.vsix 2>/dev/null || true
}

install_node
build_vsix
