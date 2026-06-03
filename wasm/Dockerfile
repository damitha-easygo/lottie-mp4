# syntax=docker/dockerfile:1.6
#
# Cross-compiles FFmpeg (upstream + Lottie patch) to WebAssembly with:
#   - x264              (H.264 encoder)
#   - ThorVG 1.x        (Lottie rasterizer used by the patched decoder)
#   - FFmpeg            (cloned from github.com/FFmpeg/FFmpeg, latest
#                        stable release branch) + the lottie support
#                        patch held alongside this file.
#
# The patch is bundled in this directory because the upstream PR
# (code.ffmpeg.org/FFmpeg/FFmpeg/pulls/22860) is not yet merged.
#
# Output: /out/ffmpeg.js  /out/ffmpeg.wasm  (consumed by --output=local)
#
# Build context is this wasm/ directory only — it just needs the
# Dockerfile and the patch file. See build.sh.
#
# FFMPEG_REF defaults to the most recent FFmpeg release branch. Docker
# will cache the `git clone` layer until the Dockerfile changes; pass
# `--no-cache` (or bump CACHE_BUST below) to refetch when the branch
# moves.

ARG EMSDK_VERSION=3.1.74
ARG THORVG_REF=v1.0.5
ARG X264_REF=stable
ARG LIBVPX_REF=v1.13.1
ARG FFMPEG_REF=release/8.1
ARG FFMPEG_PATCH=0001-lottie-support.patch
ARG CACHE_BUST=1

FROM emscripten/emsdk:${EMSDK_VERSION} AS build

ARG THORVG_REF
ARG X264_REF
ARG LIBVPX_REF
ARG FFMPEG_REF
ARG FFMPEG_PATCH
ARG CACHE_BUST

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        autoconf automake build-essential cmake git libtool meson ninja-build \
        pkg-config python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PREFIX=/opt/wasm
ENV PKG_CONFIG_PATH=${PREFIX}/lib/pkgconfig
ENV EM_PKG_CONFIG_PATH=${PREFIX}/lib/pkgconfig
RUN mkdir -p ${PREFIX}

# ----------------------------------------------------------------------------
# x264
# ----------------------------------------------------------------------------
RUN git clone --depth 1 --branch ${X264_REF} https://code.videolan.org/videolan/x264.git /src/x264
WORKDIR /src/x264
RUN emconfigure ./configure \
        --prefix=${PREFIX} \
        --host=i686-gnu \
        --enable-static \
        --disable-cli \
        --disable-asm \
        --disable-thread \
        --extra-cflags="-O3 -pthread" \
        --extra-ldflags="-pthread" \
    && emmake make -j"$(nproc)" \
    && emmake make install

# ----------------------------------------------------------------------------
# ThorVG (lottie loader, sw engine, C API, no threads)
# ----------------------------------------------------------------------------
RUN git clone --depth 1 --branch ${THORVG_REF} https://github.com/thorvg/thorvg.git /src/thorvg

# Meson cross file for Emscripten. `-pthread` propagates the atomics/bulk-memory
# WASM features ffmpeg's pthread-enabled link requires, even though ThorVG
# itself is built single-threaded (threads=false below).
RUN cat > /src/em-cross.ini <<'EOF'
[binaries]
c       = 'emcc'
cpp     = 'em++'
ar      = 'emar'
ranlib  = 'emranlib'
strip   = 'emstrip'
pkgconfig = 'pkg-config'

[host_machine]
system     = 'emscripten'
cpu_family = 'wasm32'
cpu        = 'wasm32'
endian     = 'little'

[built-in options]
default_library = 'static'
c_args     = ['-pthread']
cpp_args   = ['-pthread']
c_link_args   = ['-pthread']
cpp_link_args = ['-pthread']
EOF

WORKDIR /src/thorvg
# Option schema below matches ThorVG v1.0.x. If you bump THORVG_REF and meson
# errors with "Unknown options", re-check meson_options.txt at that tag.
RUN meson setup builddir \
        --prefix=${PREFIX} \
        --cross-file /src/em-cross.ini \
        --default-library=static \
        --buildtype=release \
        -Dengines=cpu \
        -Dloaders=all \
        -Dthreads=false \
        -Dbindings=capi \
        -Dstatic=true \
        -Dpartial=false \
        -Dtests=false \
        -Dlog=false \
        -Dextra= \
    && meson compile -C builddir \
    && meson install -C builddir

# ----------------------------------------------------------------------------
# libvpx (VP9 encoder for WebM output, with alpha support via yuva420p)
# ----------------------------------------------------------------------------
# `generic-gnu` is the target libvpx uses for unknown/cross toolchains: it
# disables all hand-written asm so everything goes through emcc. Single-
# threaded (no pthread fan-out inside the encoder), but cflags carry -pthread
# so the emitted objects share the atomics/bulk-memory feature set with the
# rest of the link — otherwise emcc rejects the mixed-feature archive.
RUN git clone --depth 1 --branch ${LIBVPX_REF} https://chromium.googlesource.com/webm/libvpx /src/libvpx
WORKDIR /src/libvpx
RUN emconfigure ./configure \
        --prefix=${PREFIX} \
        --target=generic-gnu \
        --disable-vp8 \
        --enable-vp9 \
        --enable-vp9-highbitdepth \
        --disable-multithread \
        --disable-runtime-cpu-detect \
        --enable-static \
        --disable-shared \
        --disable-examples \
        --disable-tools \
        --disable-docs \
        --disable-unit-tests \
        --extra-cflags="-O3 -pthread" \
    && emmake make -j"$(nproc)" \
    && emmake make install

# ----------------------------------------------------------------------------
# FFmpeg latest stable + Lottie patch
# ----------------------------------------------------------------------------
# CACHE_BUST is referenced so a bump on the host (via --build-arg
# CACHE_BUST=$(date +%s)) invalidates this layer and re-pulls the branch.
RUN echo "ffmpeg=${FFMPEG_REF} cache_bust=${CACHE_BUST}" && \
    git clone --depth 1 --branch ${FFMPEG_REF} \
        https://github.com/FFmpeg/FFmpeg.git /src/ffmpeg

# Copy the out-of-tree patch from the build context and apply via `git am`.
# `git am` is preferred because the file is a `git format-patch` mailbox
# (preserves authorship + commit message); it errors loudly on mismatched
# context lines, which is what we want if the patch ever drifts vs the
# pinned FFMPEG_REF.
COPY ${FFMPEG_PATCH} /src/lottie-support.patch
WORKDIR /src/ffmpeg
RUN git config user.email "wasm-build@media-playground" && \
    git config user.name  "wasm-build" && \
    git am /src/lottie-support.patch

# em++ as linker so the C++ stdlib used by ThorVG is pulled in automatically.
RUN emconfigure ./configure \
        --prefix=${PREFIX} \
        --target-os=none \
        --arch=x86_32 \
        --cpu=generic \
        --enable-cross-compile \
        --cc=emcc \
        --cxx=em++ \
        --ld=em++ \
        --objcc=emcc \
        --dep-cc=emcc \
        --ar=emar \
        --ranlib=emranlib \
        --nm=emnm \
        --strip=emstrip \
        --pkg-config-flags="--static" \
        --extra-cflags="-O3 -pthread -I${PREFIX}/include" \
        --extra-cxxflags="-O3 -pthread -I${PREFIX}/include" \
        --extra-ldflags="-pthread -L${PREFIX}/lib" \
        --disable-asm \
        --disable-inline-asm \
        --disable-stripping \
        --enable-pthreads \
        --disable-w32threads \
        --disable-network \
        --disable-runtime-cpudetect \
        --disable-debug \
        --disable-doc \
        --disable-autodetect \
        --disable-everything \
        --disable-ffplay \
        --disable-ffprobe \
        --enable-gpl \
        --enable-version3 \
        --enable-avformat \
        --enable-avcodec \
        --enable-avfilter \
        --enable-swscale \
        --enable-swresample \
        --enable-avutil \
        --enable-libx264 \
        --enable-libvpx \
        --enable-libthorvg \
        --enable-demuxer=lottie \
        --enable-decoder=libthorvg \
        --enable-encoder=libx264 \
        --enable-encoder=libvpx_vp9 \
        --enable-encoder=gif \
        --enable-muxer=mp4 \
        --enable-muxer=mov \
        --enable-muxer=webm \
        --enable-muxer=gif \
        --enable-protocol=file \
        --enable-protocol=pipe \
        --enable-bsf=h264_mp4toannexb \
        --enable-filter=scale \
        --enable-filter=format \
        --enable-filter=fps \
        --enable-filter=null \
        --enable-filter=copy \
        --enable-filter=pad \
        --enable-filter=color \
        --enable-filter=overlay \
        --enable-filter=split \
        --enable-filter=palettegen \
        --enable-filter=paletteuse \
        --progs-suffix=.js \
        --extra-ldexeflags="-pthread \
                           -s WASM=1 \
                           -s USE_PTHREADS=1 \
                           -s PROXY_TO_PTHREAD=1 \
                           -s PTHREAD_POOL_SIZE=8 \
                           -s INITIAL_MEMORY=128MB \
                           -s ALLOW_MEMORY_GROWTH=1 \
                           -s MAXIMUM_MEMORY=2GB \
                           -s TOTAL_STACK=8MB \
                           -s MODULARIZE=1 \
                           -s EXPORT_NAME=FFmpegModule \
                           -s ENVIRONMENT=web,worker \
                           -s INVOKE_RUN=0 \
                           -s EXIT_RUNTIME=0 \
                           -s FORCE_FILESYSTEM=1 \
                           -s EXPORTED_RUNTIME_METHODS=['FS','callMain','ccall','cwrap'] \
                           --closure 0"

RUN emmake make -j"$(nproc)" ffmpeg.js

RUN mkdir -p /out && cp ffmpeg.js ffmpeg.wasm /out/

# Tiny final stage so `docker buildx build --output=type=local,dest=…`
# extracts just the artifacts.
FROM scratch AS export
COPY --from=build /out/ /
