'use strict';
/**
 * Minimal host panel wiring (Snake Arcade pattern).
 * Requires: #aiFab, #aiOverlay, #aiBadge, tabs, settings fields, UniversalAI + UniversalFeedback scripts.
 */

function setUnread(n) {
  const badge = document.getElementById('aiBadge');
  const count = Number(n) || 0;
  if (!badge) return;
  if (count > 0) {
    badge.hidden = false;
    badge.style.display = '';
    badge.textContent = count > 9 ? '9+' : String(count);
  } else {
    badge.hidden = true;
    badge.style.display = 'none';
    badge.textContent = ''; // never show "0"
  }
}

function setFabVisible(visible) {
  const fab = document.getElementById('aiFab');
  if (!fab) return;
  fab.hidden = !visible;
  fab.style.display = visible ? '' : 'none';
}

function closeAIPanel() {
  const ov = document.getElementById('aiOverlay');
  if (ov) ov.hidden = true;
  setFabVisible(true);
}

const ai = window.UniversalAI.create({
  button: document.getElementById('aiFab'),
  onOpen() {
    const ov = document.getElementById('aiOverlay');
    if (ov) ov.hidden = false;
    setFabVisible(false); // hide FAB while panel open
  },
  onActions(actions) {
    // Host executes whitelist client actions only
  }
});

document.getElementById('aiClose')?.addEventListener('click', closeAIPanel);
document.getElementById('aiOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'aiOverlay') closeAIPanel();
});

const fb = window.UniversalFeedback.create({
  onUnread: setUnread,
  onSync(sync) {
    // renderDonate(sync.donate) — flatten nested Hub fields; never hard-code accounts
  }
});

setUnread(0);
setFabVisible(true);
fb.sync().catch(() => {});
