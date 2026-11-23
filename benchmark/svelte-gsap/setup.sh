#!/usr/bin/env bash
# Create the Svelte GSAP benchmark site: the pinned template plus the pages in
# site/ and menu links to them (menu-links.patch), built as static files.
# Usage: benchmark/svelte-gsap/setup.sh <empty directory for the site>
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
site=${1:?Usage: setup.sh <empty directory for the site>}
repository=https://github.com/YusufCeng1z/svelte-gsap-template
commit=a6648f678e3c8a592f108543771298d42ded7f66

mkdir -p "$site"
if [ -n "$(ls -A "$site")" ]; then
  echo "Directory is not empty: $site" >&2
  exit 1
fi
git clone --quiet "$repository" "$site"
cd "$site"
git checkout --quiet "$commit"
# Static files instead of a hosting adapter, so serve.js can serve them.
node -e "const fs=require('fs');const f='svelte.config.js';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('@sveltejs/adapter-auto','@sveltejs/adapter-static'))"
cp -r "$here/site/." .
# Link the header and footer menus to the added pages.
git apply "$here/menu-links.patch"
npm ci --no-audit --no-fund
npm run build

node "$here/../make-config.js" svelte-gsap
echo "Clean site:    node benchmark/svelte-gsap/serve.js $site   (http://localhost:4173)"
echo "With the bugs: VISUAL_BUGS=1 node benchmark/svelte-gsap/serve.js $site"
