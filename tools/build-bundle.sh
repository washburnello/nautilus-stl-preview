#!/usr/bin/env bash
# Rebuild data/stl-viewer.bundle.js from src/viewer-main.js + vendor three.js.
# Requires node + npx (network for first esbuild download only).
set -euo pipefail
cd "$(dirname "$0")/.."
npx --yes esbuild@0.25.4 src/viewer-main.js \
  --bundle --format=iife --minify \
  --alias:three=./vendor/three.module.js \
  --outfile=data/stl-viewer.bundle.js
echo "wrote data/stl-viewer.bundle.js"
