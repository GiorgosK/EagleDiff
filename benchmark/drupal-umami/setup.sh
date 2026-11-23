#!/usr/bin/env bash
# Create the Umami benchmark site with DDEV at https://eaglediff-umami.ddev.site.
# Usage: benchmark/drupal-umami/setup.sh <empty directory for the site>
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
site=${1:?Usage: setup.sh <empty directory for the site>}
drupal_version=11.4.13

mkdir -p "$site"
if [ -n "$(ls -A "$site")" ]; then
  echo "Directory is not empty: $site" >&2
  exit 1
fi
cd "$site"
ddev config --project-type=drupal11 --docroot=web --project-name=eaglediff-umami
ddev start
ddev composer create-project "drupal/recommended-project:$drupal_version" --no-interaction
ddev composer require drush/drush --no-interaction
ddev drush site:install demo_umami -y
mkdir -p web/modules/custom
cp -r "$here/visual_bugs" web/modules/custom/

# Build Drupal's caches with one request per page. A brand-new site can answer
# HTTP 500 while many first requests build them at once.
for url in $(sed -n 's/.*"url": "\([^"]*\)".*/\1/p' "$here/bugs.json"); do
  curl -sk -o /dev/null "https://eaglediff-umami.ddev.site$url"
done
node "$here/../make-config.js" drupal-umami
echo "Clean Umami site ready: https://eaglediff-umami.ddev.site"
echo "Add the bugs:    ddev drush en visual_bugs -y && ddev drush cr"
echo "Remove the bugs: ddev drush pmu visual_bugs -y && ddev drush cr"
