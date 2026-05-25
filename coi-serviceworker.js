// Cross-Origin Isolation Service Worker.
//
// The media-playground Go server doesn't set COOP/COEP headers, but
// ffmpeg.wasm uses SharedArrayBuffer (PROXY_TO_PTHREAD), which requires
// the page to be cross-origin isolated. This SW intercepts every fetch
// under its scope and re-issues the response with the required headers.
//
// Adapted from the well-known coi-serviceworker pattern.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.status === 0) return response; // opaque
        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
        headers.set("Cross-Origin-Opener-Policy",   "same-origin");
        headers.set("Cross-Origin-Resource-Policy", "same-origin");
        return new Response(response.body, {
          status:     response.status,
          statusText: response.statusText,
          headers,
        });
      })
      .catch((err) => {
        console.error("[coi-sw] fetch failed", err);
        throw err;
      }),
  );
});
