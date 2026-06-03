"use strict";

(async function () {
  const $ = (id) => document.getElementById(id);

  const logEl      = $("log");
  const fileInput  = $("file");
  const fileHint   = $("fileHint");
  const runBtn     = $("run");
  const statusText = $("statusText");
  const resultEl   = $("result");

  function setStatus(text, live) {
    statusText.textContent = text;
    statusText.classList.toggle("live", !!live);
  }

  function logReset() {
    logEl.textContent = "";
    logEl.classList.remove("empty");
  }

  function logAppend(s) {
    if (logEl.classList.contains("empty")) logEl.textContent = "";
    logEl.classList.remove("empty");
    logEl.textContent += s + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  }

  // libx264 / yuv420p require even dimensions. Snap odd numbers up.
  const snapEven = (v) => {
    const n = Math.max(2, +v | 0);
    return n + (n & 1);
  };
  function applyEvenSnap(el) {
    const before = +el.value | 0;
    const after  = snapEven(before);
    if (after !== before) el.value = String(after);
    return after;
  }
  ["width", "height"].forEach((id) => {
    const el = $(id);
    el.addEventListener("change", () => applyEvenSnap(el));
    el.addEventListener("blur",   () => applyEvenSnap(el));
  });

  // Two-way binding between the swatch <input type=color> and the hex text box.
  const bgColor = $("bg");
  const bgText  = $("bgText");
  const validHex = (s) => /^#?[0-9A-Fa-f]{6}$/.test(s);
  const normHex  = (s) => "#" + s.replace(/^#/, "").toLowerCase();
  bgColor.addEventListener("input", () => { bgText.value = bgColor.value; });
  bgText.addEventListener("input", () => {
    if (validHex(bgText.value)) bgColor.value = normHex(bgText.value);
  });

  // Cache the raw bytes so we don't re-read the file on encode (we already
  // had to read it for the W/H/FPS sniff).
  let pickedBytes = null;
  let pickedName  = null;

  fileInput.addEventListener("change", async () => {
    pickedBytes = null;
    pickedName  = null;
    const f = fileInput.files[0];
    if (!f) {
      fileHint.textContent = "no file selected";
      return;
    }
    const sizeKb = (f.size / 1024).toFixed(1);
    fileHint.textContent = `${f.name} · ${sizeKb} KB · parsing…`;
    try {
      const buf  = await f.arrayBuffer();
      const text = new TextDecoder().decode(buf);
      const json = JSON.parse(text);
      const w  = +json.w  | 0;
      const h  = +json.h  | 0;
      const fr = +json.fr | 0;
      if (w  > 0) $("width").value  = String(snapEven(w));
      if (h  > 0) $("height").value = String(snapEven(h));
      if (fr > 0) $("fps").value    = String(fr);
      pickedBytes = new Uint8Array(buf);
      pickedName  = f.name;
      const dims = (w > 0 && h > 0) ? `${w}×${h}` : "?×?";
      const rate = fr > 0 ? `${fr} fps` : "? fps";
      fileHint.textContent = `${f.name} · ${sizeKb} KB · source ${dims} @ ${rate}`;
    } catch (e) {
      fileHint.textContent = `${f.name} · ${sizeKb} KB · not a valid lottie json`;
      console.error(e);
    }
  });

  if (typeof FFmpegModule !== "function") {
    setStatus("ffmpeg.js failed to load");
    return;
  }
  setStatus("ready · pick a lottie json", false);
  runBtn.disabled = false;

  // Each encode gets a fresh Module: EXIT_RUNTIME=0 means main() cannot be
  // safely re-entered on the same heap. The wasm binary is browser-cached
  // after the first fetch.
  async function encodeOnce({ inputBytes, args }) {
    let exitResolver = null;
    const finished = new Promise((resolve) => { exitResolver = resolve; });

    const sniff = (s) => {
      logAppend(s);
      if (!exitResolver) return;
      // Module.onExit is gated off when EXIT_RUNTIME=0 (see ffmpeg.js: only
      // fires when !keepRuntimeAlive()). Detect the "program exited" line
      // emscripten prints instead.
      const m = /program exited \(with status: (-?\d+)\)/.exec(s);
      if (m) { const r = exitResolver; exitResolver = null; r({ code: +m[1] }); }
    };

    const M = await FFmpegModule({
      print:        sniff,
      printErr:     sniff,
      locateFile:   (p) => (p.endsWith(".wasm") ? "ffmpeg.wasm" : p),
      noInitialRun: true,
      // Prevent emscripten's default stdin handler from popping window.prompt()
      // when ffmpeg polls stdin (the "press q to quit" loop).
      stdin:        () => null,
      onExit:  (code) => { if (exitResolver) { const r = exitResolver; exitResolver = null; r({ code }); } },
      onAbort: (msg)  => { if (exitResolver) { const r = exitResolver; exitResolver = null; r({ code: -1, abort: String(msg) }); } },
    });

    M.FS.writeFile("input.json", inputBytes);
    M.callMain(args);

    const r = await finished;
    if (r.abort) logAppend("Abort: " + r.abort);

    let out = null;
    try { out = M.FS.readFile("output.mp4"); } catch (_) {}
    return { exitCode: r.code, data: out };
  }

  runBtn.addEventListener("click", async () => {
    if (!pickedBytes) {
      setStatus("pick a lottie json first", false);
      return;
    }

    const w   = applyEvenSnap($("width"));
    const h   = applyEvenSnap($("height"));
    const fps = +$("fps").value | 0;
    const crf = +$("crf").value | 0;
    const bg  = validHex(bgText.value) ? normHex(bgText.value) : "#000000";
    const inputBytes = pickedBytes;

    // Two-stage filter graph: a solid color source sits under the rgba
    // Lottie so transparency is composited onto `bg` before we drop alpha
    // for yuv420p. `shortest=1` clips the (otherwise infinite) color
    // source to the length of the Lottie.
    const filterGraph =
      `color=c=${bg}:s=${w}x${h}:r=${fps}[bg];` +
      `[bg][0:v]overlay=shortest=1:format=auto,format=yuv420p[out]`;

    const args = [
      "-y",
      "-c:v", "libthorvg", "-width", String(w), "-height", String(h),
      "-f", "lottie",
      "-i", "input.json",
      "-filter_complex", filterGraph,
      "-map", "[out]",
      "-r", String(fps),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "output.mp4",
    ];

    runBtn.disabled = true;
    resultEl.innerHTML  = "";
    logReset();
    logAppend("$ ffmpeg " + args.join(" "));
    setStatus(`encoding · ${w}×${h} · ${fps} fps · crf ${crf}`, true);

    const t0 = performance.now();
    let result = null;
    try {
      result = await encodeOnce({ inputBytes, args });
    } catch (e) {
      logAppend("Exception: " + (e && e.stack ? e.stack : e));
    }
    const dt = ((performance.now() - t0) / 1000).toFixed(2);

    const data = result && result.data;
    if (data && data.length > 0) {
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      const url  = URL.createObjectURL(blob);

      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;

      const dl = document.createElement("a");
      dl.className = "download";
      dl.href = url;
      dl.download = ((pickedName || "lottie").replace(/\.json$/i, "")) + ".mp4";
      dl.textContent = `Download ${dl.download}`;

      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${(data.length / 1024).toFixed(1)} KB · h.264 · ${w}×${h} · ${dt}s`;

      resultEl.appendChild(video);
      resultEl.appendChild(dl);
      resultEl.appendChild(meta);

      setStatus(`done · ${dt}s`, false);
    } else {
      setStatus(`failed · exit ${result ? result.exitCode : "—"} · ${dt}s`, false);
    }

    runBtn.disabled = false;
  });
})();
