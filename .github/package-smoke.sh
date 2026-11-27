#!/usr/bin/env bash
# Install Eaglediff the way users do (npm pack + npm install), then run a real
# reference, calibrate and test against a local page. Catches packaging
# problems that tests in the checkout cannot see, such as dependency paths
# that only exist in a pnpm or source layout.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
server=""
cleanup() { [ -n "$server" ] && kill "$server" 2>/dev/null; rm -rf "$work"; }
trap cleanup EXIT

(cd "$repo" && npm pack --silent --pack-destination "$work" >/dev/null)
tarball=$(ls "$work"/eaglediff-*.tgz)

mkdir -p "$work/site"
page() { printf '<!doctype html><title>Smoke</title><h1>Package check</h1><p>%s page.</p>\n' "$1" > "$work/site/index.html"; }
port=4199
node -e "
  const fs = require('fs'), http = require('http');
  http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(fs.readFileSync('$work/site/index.html'));
  }).listen($port, '127.0.0.1');
" &
server=$!
sleep 1
export EAGLEDIFF_DEFAULTS=none

# A global install keeps dependencies inside the package; a project install
# (npm install --save-dev, npx) puts them next to it.
for layout in global project; do
  echo "== npm $layout install"
  if [ "$layout" = global ]; then
    npm install --silent --global --prefix "$work/global" "$tarball"
    eaglediff="$work/global/bin/eaglediff"
  else
    mkdir -p "$work/project-install"
    (cd "$work/project-install" && npm init -y >/dev/null && npm install --silent "$tarball")
    eaglediff="$work/project-install/node_modules/.bin/eaglediff"
  fi
  "$eaglediff" --version
  page Unchanged
  project="$work/test-$layout"
  mkdir -p "$project"
  (
    cd "$project"
    "$eaglediff" config --ref="http://127.0.0.1:$port"
    "$eaglediff" reference
    "$eaglediff" calibrate
    page Changed
    if "$eaglediff" test; then
      echo "test passed although the page changed ($layout install)" >&2
      exit 1
    fi
  )
done
echo "Package smoke test passed: global and project installs calibrated and detected a change."
