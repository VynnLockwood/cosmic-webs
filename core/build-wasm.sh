#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
wasm-pack build --target web --release --out-dir ../web/src/wasm
