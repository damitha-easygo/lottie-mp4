# lottie-mp4

Convert Lottie JSON animations to H.264 MP4 entirely in the browser. Runs
on a WASM build of FFmpeg + ThorVG + libx264. No server, no upload.

## Running locally

The page needs cross-origin isolation (SharedArrayBuffer) for ffmpeg.wasm
pthreads. A bundled service worker injects the required COOP/COEP headers
so any plain static server works:

```sh
npx serve .
# or
python3 -m http.server 8080
```

On first load the service worker registers and the page reloads itself
once into a cross-origin-isolated context.

## Files

| File | Purpose |
|---|---|
| `index.html` | UI |
| `app.js` | Encode pipeline + DOM glue |
| `ffmpeg.js` | Emscripten glue loader for the wasm binary |
| `ffmpeg.wasm` | FFmpeg + ThorVG + libx264 compiled to WebAssembly (~4 MB) |
| `coi-serviceworker.js` | Re-issues responses with COOP/COEP headers |
| `wasm/` | Cross-compile recipe — see [`wasm/README.md`](wasm/README.md) |

## Rebuilding ffmpeg.wasm

```sh
./wasm/build.sh
```

First run is 30–60 minutes (downloads emsdk, clones x264 + ThorVG +
FFmpeg, compiles everything). Subsequent runs hit the Docker layer cache.

See [`wasm/README.md`](wasm/README.md) for env knobs and how to maintain
the Lottie patch.

## Hosting

Works on any plain static host (S3, GitHub Pages, Netlify, Cloudflare
Pages, etc.) because `coi-serviceworker.js` patches COOP/COEP per
response. To set those headers at the edge instead (cleaner, no SW), add:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

…then you can delete `coi-serviceworker.js` and remove the registration
block at the top of `index.html`.
