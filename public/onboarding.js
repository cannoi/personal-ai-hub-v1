/**
 * 3-step onboarding for first-time Personal AI Hub users.
 * Steps: (1) Admin password (2) Add key / Ollama (3) Create token + copy Base URL
 */
(function () {
  const KEY = 'pah_onboarding_done_v2';
  function done() {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  }
  function markDone() {
    try { localStorage.setItem(KEY, '1'); } catch {}
  }
  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }
  function icon(name) {
    return (window.PAH_ICONS && PAH_ICONS.icon(name, 'w-5 h-5 inline-block')) || '';
  }

  function build() {
    if (done()) return;
    const overlay = el(`
<div id="pah-onboarding" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4" style="backdrop-filter:blur(4px)">
  <div class="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden">
    <div class="px-5 pt-5 pb-3 border-b border-slate-800 flex items-center justify-between">
      <div class="flex items-center gap-2 font-semibold text-indigo-300">
        ${icon('bot')} <span data-i18n="app.name">Personal AI Hub</span> <span class="text-xs text-slate-400">v2</span>
      </div>
      <button type="button" id="pah-ob-skip" class="text-xs text-slate-400 hover:text-white">Skip</button>
    </div>
    <div class="px-5 py-4" id="pah-ob-body"></div>
    <div class="px-5 pb-5 flex items-center justify-between gap-2">
      <div class="flex gap-1" id="pah-ob-dots"></div>
      <div class="flex gap-2">
        <button type="button" id="pah-ob-back" class="px-3 py-1.5 rounded-lg text-sm bg-slate-800 hover:bg-slate-700 hidden">Back</button>
        <button type="button" id="pah-ob-next" class="px-4 py-1.5 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 font-medium">Next</button>
      </div>
    </div>
  </div>
</div>`);
    document.body.appendChild(overlay);

    const steps = [
      {
        title: '1. Admin password',
        html: `<div class="space-y-3 text-sm">
          <div class="flex items-center gap-2 text-indigo-300">${icon('lock')} <strong data-i18n="setup.step1">Set admin password</strong></div>
          <p class="text-slate-300">Protect Settings, API keys and gateway tokens. If you did not set <code class="text-indigo-300">AI_HUB_ADMIN_PASSWORD</code>, check the container log for the auto-generated password on first start.</p>
          <p class="text-slate-400 text-xs">Login is required for the control plane. The public <code>/v1</code> API uses separate <code>pah_</code> tokens.</p>
        </div>`
      },
      {
        title: '2. Add AI provider',
        html: `<div class="space-y-3 text-sm">
          <div class="flex items-center gap-2 text-indigo-300">${icon('cloud')} <strong data-i18n="setup.step2">Add API key or enable Ollama</strong></div>
          <ul class="list-disc pl-5 space-y-1 text-slate-300">
            <li>Open <strong>Settings</strong> → choose provider (OpenAI, Gemini, DeepSeek, …) → paste key → <em>Test</em>.</li>
            <li>Or use <strong>Local AI</strong> (Ollama) and pull a small model.</li>
          </ul>
          <p class="text-slate-400 text-xs flex items-center gap-1">${icon('chip')} Keys stay inside this Hub — never paste provider keys into other apps.</p>
        </div>`
      },
      {
        title: '3. Connect apps',
        html: `<div class="space-y-3 text-sm">
          <div class="flex items-center gap-2 text-indigo-300">${icon('plug')} <strong data-i18n="setup.step3">Create gateway token & connect apps</strong></div>
          <ol class="list-decimal pl-5 space-y-1 text-slate-300">
            <li>Create a <code>pah_</code> token in Gateway / Settings.</li>
            <li>Copy <strong>Base URL</strong> (e.g. <code>http://personal-ai-hub:8080/v1</code> or public <code>:59971/v1</code>).</li>
            <li>In App Builder: OpenAI-compatible → Base URL + token → model <code>auto</code>.</li>
          </ol>
          <p class="text-slate-400 text-xs flex items-center gap-1">${icon('spark')} <code>/v1</code> is transparent: your prompts are not mixed with Hub knowledge.</p>
        </div>`
      }
    ];

    let i = 0;
    const body = overlay.querySelector('#pah-ob-body');
    const dots = overlay.querySelector('#pah-ob-dots');
    const back = overlay.querySelector('#pah-ob-back');
    const next = overlay.querySelector('#pah-ob-next');

    function render() {
      body.innerHTML = steps[i].html;
      dots.innerHTML = steps.map((_, idx) =>
        `<span class="inline-block w-2 h-2 rounded-full ${idx === i ? 'bg-indigo-400' : 'bg-slate-600'}"></span>`
      ).join('');
      back.classList.toggle('hidden', i === 0);
      next.textContent = i === steps.length - 1 ? 'Finish' : 'Next';
    }
    function close() {
      markDone();
      overlay.remove();
    }
    back.onclick = () => { if (i > 0) { i--; render(); } };
    next.onclick = () => {
      if (i < steps.length - 1) { i++; render(); }
      else close();
    };
    overlay.querySelector('#pah-ob-skip').onclick = close;
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(build, 400));
  else setTimeout(build, 400);
})();
