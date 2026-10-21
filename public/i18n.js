/**
 * Minimal i18n for Personal AI Hub UI (en + vi).
 * Auto-detects navigator.language; toggle via setHubLang('en'|'vi').
 */
(function (global) {
  const CACHE = {};
  let lang = (typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('vi')) ? 'vi' : 'en';
  try {
    const saved = localStorage.getItem('pah_lang');
    if (saved === 'en' || saved === 'vi') lang = saved;
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
    try { localStorage.setItem('pah_lang', l); } catch {}
    await load(l);
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k, el.textContent);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const k = el.getAttribute('data-i18n-placeholder');
      if (k) el.setAttribute('placeholder', t(k, el.getAttribute('placeholder') || ''));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const k = el.getAttribute('data-i18n-title');
      if (k) el.setAttribute('title', t(k, el.getAttribute('title') || ''));
    });
    // Sync language toggle buttons
    document.querySelectorAll('[data-lang-set]').forEach(btn => {
      const l = btn.getAttribute('data-lang-set');
      btn.classList.toggle('ring-2', l === lang);
      btn.classList.toggle('ring-indigo-400', l === lang);
    });
    document.documentElement.lang = l;
    document.dispatchEvent(new CustomEvent('pah:lang', { detail: { lang: l } }));
  }

  async function initI18n() {
    await load('en');
    await load(lang);
    await setHubLang(lang);
  }

  global.PAH_I18N = { t, setHubLang, initI18n, getLang: () => lang };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initI18n);
  else initI18n();
})(typeof window !== 'undefined' ? window : globalThis);

  // Floating EN/VI toggle
  function mountLangToggle() {
    if (document.getElementById('pah-lang-toggle')) return;
    const box = document.createElement('div');
    box.id = 'pah-lang-toggle';
    box.className = 'fixed bottom-4 right-4 z-[9000] flex gap-1 rounded-full bg-slate-900/90 border border-slate-700 p-1 shadow-lg';
    box.innerHTML = `
      <button type="button" data-lang-set="en" class="px-2.5 py-1 text-xs rounded-full text-slate-200 hover:bg-slate-700">EN</button>
      <button type="button" data-lang-set="vi" class="px-2.5 py-1 text-xs rounded-full text-slate-200 hover:bg-slate-700">VI</button>`;
    document.body.appendChild(box);
    box.querySelectorAll('[data-lang-set]').forEach(btn => {
      btn.addEventListener('click', () => setHubLang(btn.getAttribute('data-lang-set')));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountLangToggle);
  else mountLangToggle();
