// Known visual bugs for the Svelte GSAP benchmark; see ../bugs.json.
// serve.js calls page() for every HTML page when VISUAL_BUGS=1. Each bug is
// scoped to one page: a data-visual-bug attribute on <html> for CSS bugs, or a
// change to that page's HTML.
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, 'bugs.css'), 'utf8');

const pages = {
  '/': 's01',
  '/studio': 's02',
  '/services': 's03',
  '/work': 's04',
  '/work/nike-forward': 's05',
  '/work/ozone-webgl': 's06',
  '/work/lumina-app': 's07',
  '/work/aura-engine': 's08',
  '/journal': 's09',
  '/journal/motion-budgets': 's10',
  '/contact': 's11',
  '/careers': 's12'
};

// s09: a notice bar inserted at the top of the page 2 seconds after load.
const lateNotice = 'setTimeout(function () { var p = document.createElement("p"); p.className = "visual-bugs-notice"; ' +
  'p.textContent = "New: our 2026 showreel is out"; document.body.prepend(p); }, 2000);';

const htmlBugs = {
  // s01: "Stripe" is invisible in the logo marquee.
  s01: html => html.replace(/(<div class="[^"]*")(>Stripe<\/div>)/g, '$1 style="visibility:hidden"$2'),
  // s02: a one-letter typo in the footer heading. It is static template text,
  // which hydration keeps as served.
  s02: html => html.replace('Have a project<br', 'Have a projcet<br'),
  // s05: the project cover image points to a file that does not exist (HTTP 404).
  s05: html => html.replace(/src="\/og-image\.png"/, 'src="/visual-bugs-missing.png"'),
  // s06: a one-letter typo in the "Next project" label. Text that comes from
  // page data is rendered again by the browser, so this static label is used.
  s06: html => html.replace('>Next project<', '>Next poject<'),
  s09: html => html.replace('</body>', `<script>${lateNotice}</script></body>`)
};

function page(pathname, html) {
  const bug = pages[pathname.replace(/\/+$/, '') || '/'];
  if (!bug) return html;
  html = html.replace('<html', `<html data-visual-bug="${bug}"`).replace('</head>', `<style>${css}</style></head>`);
  return htmlBugs[bug] ? htmlBugs[bug](html) : html;
}

module.exports = { page };
