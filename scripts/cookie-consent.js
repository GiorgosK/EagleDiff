// Deliberately specific: never click a generic "Accept" button outside a known CMP.
const providers = [
  { name: 'OneTrust', banners: ['#onetrust-banner-sdk', '#onetrust-pc-sdk', '.onetrust-pc-dark-filter'],
    dialogs: ['#onetrust-banner-sdk', '#onetrust-pc-sdk'],
    accept: ['#onetrust-accept-btn-handler', '#accept-recommended-btn-handler'] },
  { name: 'Cookiebot', banners: ['#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay'],
    dialogs: ['#CybotCookiebotDialog'],
    accept: ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll'] },
  { name: 'European Commission Webtools', banners: ['.wt-cck--banner'],
    dialogs: ['.wt-cck--banner .wt-cck--container'],
    accept: ['.wt-cck--banner .wt-cck--actions-button[href="#accept"]'] },
  { name: 'CookieScript', banners: ['#cookiescript_injected_wrapper', '#cookiescript_injected'],
    dialogs: ['#cookiescript_injected'], accept: ['#cookiescript_accept'] },
  { name: 'Automattic/A8C', banners: ['.a8c-cookie-banner'], dialogs: ['.a8c-cookie-banner'],
    accept: ['.a8c-cookie-banner .a8c-cookie-banner__accept-all-button'] },
  { name: 'Cookie Consent component', banners: ['#cookie-consent.cookie-consent__wrapper'],
    dialogs: ['#cookie-consent.cookie-consent__wrapper--visible'],
    accept: ['#cookie-consent.cookie-consent__wrapper--visible .cookie-all__btn'] },
  { name: 'Didomi', banners: ['#didomi-host'], dialogs: ['#didomi-notice', '#didomi-popup'], accept: ['#didomi-notice-agree-button'] }
];
const bannerSelectors = providers.flatMap(provider => provider.banners);

function resolveOptions(config = {}, scenario = {}) {
  const emptySelectors = value => Array.isArray(value) && value.length === 0;
  const leaveByEmptySelectors = emptySelectors(scenario.hideDynamicSelectors);
  const defaultMode = config.defaults?.cookieConsent ??
    (emptySelectors(config.defaults?.hideDynamicSelectors) ? 'leave' : 'hide');
  const mode = scenario.cookieConsent ?? (leaveByEmptySelectors ? 'leave' : defaultMode);
  const timeout = scenario.cookieConsentTimeout ?? config.defaults?.cookieConsentTimeout ?? 3000;
  if (!['hide', 'accept', 'leave'].includes(mode)) throw new Error('cookieConsent must be "hide", "accept" or "leave".');
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('cookieConsentTimeout must be a positive number.');
  return { mode, timeout };
}

module.exports = { providers, bannerSelectors, resolveOptions };
