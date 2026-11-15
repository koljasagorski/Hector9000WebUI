#!/bin/bash
# Builds websockets-doom.js / .wasm (see ../README.md). Runs INSIDE the emsdk container:
# stdin = tar of the doom-wasm source, logs go to stderr, the result (tar) goes to fd 3,
# i.e. to the original stdout.
#
#   git clone https://github.com/cloudflare/doom-wasm && git -C doom-wasm checkout 65e0d3ae2ffa604155eebd96ed40da6567bd08f4
#   tar -c doom-wasm | docker run --rm -i --platform linux/amd64 emscripten/emsdk:3.1.64 \
#       bash -c "$(cat build.sh)" > result.tar
#   tar -xf result.tar     # websockets-doom.js, websockets-doom.wasm, tmp/ (emcc version, patch)
#
# -g0 matters: with debug info Binaryen only runs limited optimisations (7.5 MB instead of 2.2 MB).
set -euo pipefail
exec 3>&1 1>&2
mkdir -p /w && tar -x -C /w
cd /w/doom-wasm
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq automake autoconf libtool pkg-config >/dev/null
emcc --version | head -1 > /tmp/emcc-version.txt
cat /tmp/emcc-version.txt

# --- Hector patch: lean flags for a Raspberry Pi 2/3 kiosk ---
cp configure.ac /tmp/configure.ac.orig
python3 - <<'PY'
import re
p = "configure.ac"
s = open(p).read()
new = ('EMFLAGS="-s INVOKE_RUN=1 -s USE_SDL=2 -s USE_SDL_MIXER=2 -s LEGACY_GL_EMULATION=0 '
       '-s USE_SDL_NET=2 -s ASSERTIONS=0 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 '
       '-s INITIAL_MEMORY=100663296 -s MAXIMUM_MEMORY=268435456 -s FORCE_FILESYSTEM=1 '
       '-s EXPORTED_RUNTIME_METHODS=[\'FS\',\'ccall\',\'callMain\'] -s EXIT_RUNTIME=1 '
       '-s PROXY_POSIX_SOCKETS=0 -s USE_PTHREADS=0 -s PROXY_TO_PTHREAD=0 '
       '-s ERROR_ON_UNDEFINED_SYMBOLS=0 -s ASYNCIFY -O3"')
s2, n = re.subn(r'^EMFLAGS=.*$', lambda m: new, s, flags=re.M)
assert n == 1
open(p, "w").write(s2)
PY
diff -u --label a/configure.ac --label b/configure.ac /tmp/configure.ac.orig configure.ac > /tmp/doom-wasm-hector.patch || true
emconfigure autoreconf -fiv
ac_cv_exeext=".html" emconfigure ./configure --host=none-none-none CFLAGS="-g0" LDFLAGS="-g0"
emmake make -j4
ls -la src/*.js src/*.wasm src/*.html 2>&1 || true
cd src
tar -c -f - websockets-doom.js websockets-doom.wasm /tmp/emcc-version.txt /tmp/doom-wasm-hector.patch >&3
