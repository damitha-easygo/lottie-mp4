#!/usr/bin/env bash
# Cross-compile FFmpeg (latest stable + bundled Lottie patch) to WebAssembly
# and install the artifacts into the repo root.
#
# The build is self-contained: the FFmpeg source is cloned from
# github.com/FFmpeg/FFmpeg inside the Docker layer, and the Lottie support
# patch (0001-lottie-support.patch in this directory) is applied via
# `git am`. No external checkout is needed.
#
# First-time build is 30–60 minutes (x264 + ThorVG + FFmpeg). Subsequent
# runs hit the docker layer cache for everything that didn't change.
#
# Overrides via env:
#   FFMPEG_REF   default release/8.1 — latest FFmpeg stable release branch
#   THORVG_REF   default v1.0.5
#   X264_REF     default stable
#   LIBVPX_REF   default v1.13.1
#   OUT_DIR      default <repo root>
#
# By default each invocation bumps CACHE_BUST so the FFmpeg clone layer
# re-pulls the branch tip. Set CACHE_BUST=0 to keep using whatever Docker
# already has cached (faster repeat builds when you know the branch hasn't
# moved).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUT_DIR="${OUT_DIR:-$REPO_ROOT}"

if [ ! -f "$SCRIPT_DIR/0001-lottie-support.patch" ]; then
    echo "Missing $SCRIPT_DIR/0001-lottie-support.patch" >&2
    exit 1
fi

# CACHE_BUST defaults to a timestamp so the FFmpeg git clone layer is
# refreshed on each invocation. Explicit CACHE_BUST=0 keeps the cache.
: "${CACHE_BUST:=$(date +%s)}"

BUILD_ARGS=(--build-arg "CACHE_BUST=$CACHE_BUST")
[ -n "${FFMPEG_REF:-}" ] && BUILD_ARGS+=(--build-arg "FFMPEG_REF=$FFMPEG_REF")
[ -n "${THORVG_REF:-}" ] && BUILD_ARGS+=(--build-arg "THORVG_REF=$THORVG_REF")
[ -n "${X264_REF:-}"   ] && BUILD_ARGS+=(--build-arg "X264_REF=$X264_REF")
[ -n "${LIBVPX_REF:-}" ] && BUILD_ARGS+=(--build-arg "LIBVPX_REF=$LIBVPX_REF")

echo "==> Building to $OUT_DIR"
mkdir -p "$OUT_DIR"

cd "$SCRIPT_DIR"

# BuildKit is required for --output=type=local.
docker buildx build \
    -f Dockerfile \
    --target=export \
    --output="type=local,dest=$OUT_DIR" \
    --progress=plain \
    "${BUILD_ARGS[@]}" \
    "$@" \
    .

ls -lh "$OUT_DIR/ffmpeg.js" "$OUT_DIR/ffmpeg.wasm"
echo
echo "==> Done. Artifacts in $OUT_DIR"
