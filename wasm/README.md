# wasm/

Cross-compiles FFmpeg + ThorVG + x264 to WebAssembly for the lottie-mp4
static site.

```
wasm/
├── Dockerfile                       # the actual build recipe
├── build.sh                         # thin wrapper around docker buildx
├── 0001-lottie-support.patch        # PR #22860 (Lottie support), not yet merged upstream
└── README.md                        # this file
```

## What it produces

| File | Path | Size |
|---|---|---|
| `ffmpeg.js`   | `../ffmpeg.js`   | ~210 KB (emscripten glue) |
| `ffmpeg.wasm` | `../ffmpeg.wasm` | ~4   MB |

Artifacts land in the repo root, next to `index.html` and `app.js`.

## Prerequisites

- **Docker Desktop** with BuildKit (it's the default on modern Docker).
  `docker buildx version` should print something.
- ~5 GB of free disk for the build layers (emsdk + intermediate objects).
  Cached subsequent builds are much smaller.

## Build

From the repo root:

```sh
./wasm/build.sh
```

First run is **30–60 minutes** (downloads emsdk, clones x264 + ThorVG +
FFmpeg, compiles everything). Subsequent runs hit the Docker layer cache
and only redo whatever changed.

## What the Dockerfile does

1. Pulls `emscripten/emsdk:3.1.74` and apt-installs meson + ninja + git.
2. Clones x264 (`stable` branch from VideoLAN), configures it
   single-threaded with `-pthread` cflags so the resulting `.o` files have
   the WASM bulk-memory + atomics features required by the rest of the
   link.
3. Clones ThorVG (`v1.0.5` from GitHub), configures meson with
   `loaders=lottie, engines=cpu, threads=false, bindings=capi, static=true,
   extra=` (drops the default `openmp`).
4. Clones FFmpeg `release/8.1` from `github.com/FFmpeg/FFmpeg` and applies
   `0001-lottie-support.patch` via `git am`.
5. Configures FFmpeg with the minimum set of demuxers / decoders /
   encoders / muxers / filters needed for the page (`lottie` →
   `libthorvg` → `libx264` → `mp4`), plus `--enable-pthreads` and
   `--enable-libthorvg --enable-libx264`.
6. Links with `em++` and these emscripten flags:
   `-pthread -s USE_PTHREADS=1 -s PROXY_TO_PTHREAD=1 -s PTHREAD_POOL_SIZE=8
    -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=2GB -s MODULARIZE=1
    -s EXPORT_NAME=FFmpegModule -s INVOKE_RUN=0 -s EXIT_RUNTIME=0
    -s FORCE_FILESYSTEM=1 -s EXPORTED_RUNTIME_METHODS=[FS,callMain,ccall,cwrap]`.
7. Outputs `ffmpeg.js` + `ffmpeg.wasm` to a `scratch`-based `export`
   stage, which `build.sh` extracts via
   `--output=type=local,dest=<repo root>`.

## Env knobs

All optional. Defaults shown.

| Env var | Default | Notes |
|---|---|---|
| `FFMPEG_REF`  | `release/8.1` | Branch or tag on `github.com/FFmpeg/FFmpeg`. The bundled patch is targeted at this ref. |
| `THORVG_REF`  | `v1.0.5`      | Tag on `github.com/thorvg/thorvg`. If you bump it, re-check `meson_options.txt` (option names occasionally rename across minor versions). |
| `X264_REF`    | `stable`      | Branch on `code.videolan.org/videolan/x264.git`. |
| `OUT_DIR`     | `<repo root>` | Where ffmpeg.js / ffmpeg.wasm land. |
| `CACHE_BUST`  | `$(date +%s)` | Auto-bumped on every invocation so the FFmpeg `git clone` layer re-pulls the branch tip. Set `CACHE_BUST=0` for fast no-op rebuilds. |

Examples:

```sh
# Build against the development branch.
FFMPEG_REF=master ./wasm/build.sh

# Try a newer ThorVG.
THORVG_REF=v1.1.0 ./wasm/build.sh

# Force a fully cold rebuild.
./wasm/build.sh --no-cache
```

## Maintaining the Lottie patch

The patch lives at `wasm/0001-lottie-support.patch` because PR #22860 on
`code.ffmpeg.org/FFmpeg/FFmpeg/pulls/22860` hasn't merged yet.

### Refresh from the PR

```sh
curl -sSL -o wasm/0001-lottie-support.patch \
    https://code.ffmpeg.org/FFmpeg/FFmpeg/pulls/22860.patch
```

If the patch ever fails to apply cleanly on the pinned `FFMPEG_REF`, you
have two options:

1. **Bump the patch** — fetch the latest version from the PR (per the
   command above), which is usually already rebased on master.
2. **Bump `FFMPEG_REF`** — point at an older ref the existing patch was
   based on, or at master if the PR was rebased there.

### After upstream merges

When the PR lands in an FFmpeg release:

1. Bump `FFMPEG_REF` to that release branch.
2. Delete `0001-lottie-support.patch`.
3. Remove the `COPY ${FFMPEG_PATCH}` and `git am` steps from the
   `Dockerfile`.

## Troubleshooting

**`docker buildx: command not found`** — Docker Desktop has BuildKit
built in. Make sure Docker Desktop is up to date and the daemon is
running (`docker info` should print a server section).

**`failed to receive status: rpc error: code = Unavailable`** — the
Docker daemon crashed mid-build (we've seen this on macOS under heavy
parallel compile). Restart Docker Desktop and rerun; the layer cache
survives.

**ThorVG meson: `Unknown options`** — the option schema changed between
ThorVG versions. Check `meson_options.txt` at the tag you're pinning to
and update the `meson setup ...` line in the Dockerfile.

**`wasm-ld: --shared-memory is disallowed by *.o because it was not
compiled with 'atomics' or 'bulk-memory' features`** — one of x264 /
ThorVG was built without `-pthread`. Both must carry it (we keep them
single-threaded internally but the WASM target features still need to
match the pthread-enabled FFmpeg link).

**Browser console: `SharedArrayBuffer transfer requires
self.crossOriginIsolated`** — the page isn't cross-origin isolated.
`coi-serviceworker.js` injects the COOP/COEP headers; if it isn't taking
effect, hard-refresh once after first visit so the SW activates and the
page reloads through it.
