#!/usr/bin/env bash
# Create the Elementor benchmark site with DDEV at https://eaglediff-elementor.ddev.site.
# Usage: benchmark/wordpress-elementor/setup.sh <empty directory for the site>
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
site=${1:?Usage: setup.sh <empty directory for the site>}
wordpress_version=7.1.5
theme_version=3.5.2
elementor_version=4.4.1
url=https://eaglediff-elementor.ddev.site

mkdir -p "$site"
if [ -n "$(ls -A "$site")" ]; then
  echo "Directory is not empty: $site" >&2
  exit 1
fi
cd "$site"
ddev config --project-type=wordpress --docroot=web --project-name=eaglediff-elementor
ddev start
ddev wp core download --path=web --version="$wordpress_version"
ddev wp core install --path=web --url="$url" --title=Lumen \
  --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email
ddev wp theme install hello-elementor --version="$theme_version" --activate --path=web
ddev wp plugin install elementor --version="$elementor_version" --activate --path=web
cp "$here/content.php" web/benchmark-content.php
ddev wp eval-file web/benchmark-content.php --path=web
rm web/benchmark-content.php
ddev wp rewrite structure '/%postname%/' --hard --path=web
cp -r "$here/visual-bugs" web/wp-content/plugins/

# One request per page: Elementor writes each page's CSS file on its first visit.
for page in $(sed -n 's/.*"url": "\([^"]*\)".*/\1/p' "$here/bugs.json"); do
  curl -sk -o /dev/null "$url$page"
done
node "$here/../make-config.js" wordpress-elementor
echo "Clean Elementor site ready: $url"
echo "Add the bugs:    ddev wp plugin activate visual-bugs --path=web"
echo "Remove the bugs: ddev wp plugin deactivate visual-bugs --path=web"
