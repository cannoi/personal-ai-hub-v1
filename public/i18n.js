/**
 * Shared i18n helper for Personal AI Hub.
 * Main language switch is the header #lang-btn (EN/VI) in index.html.
 * This module only loads JSON dictionaries for secondary panels / onboarding.
 * Do NOT mount a second floating language control.
 */
(function (global) {
  const CACHE = {};
  let lang = 'en';
  try {
    const saved = localStorage.getItem('lang') || localStorage.getItem('pah_lang');
    if (saved === 'en' || saved === 'vi') lang = saved;
    else if (typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('vi')) lang = 'vi';
  } catch {}

  async function load(l) {
    if (CACHE[l]) return CACHE[l];
    try {
      const r = await fetch('/i18n/' + l + '.json', { cache: 'no-store' });
      CACHE[l] = await r.json();
    } catch {
      CACHE[l] = {};
    }
    return CACHE[l];
  }

  function t(key, fallback) {
    const dict = CACHE[lang] || {};
    return dict[key] || (CACHE.en && CACHE.en[key]) || fallback || key;
  }

  async function setHubLang(l) {
    if (l !== 'en' && l !== 'vi') return;
    lang = l;
    try {
      localStorage.setItem('pah_lang', l);
      localStorage.setItem('lang', l);
    } catch {}
    await load(l);
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k, el.textContent);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const k = el.getAttribute('data-i18n-placeholder');
      if (k) el.setAttribute('placeholder', t(k, el.getAttribute('placeholder') || ''));
    });
    document.documentElement.lang = l;
    document.dispatchEvent(new CustomEvent('pah:lang', { detail: { lang: l } }));
  }

  async function initI18n() {
    await load('en');
    await load(lang);
  }

  global.PAH_I18N = { t, setHubLang, initI18n, getLang: () => lang };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initI18n);
  else initI18n();
})(typeof window !== 'undefined' ? window : globalThis);
