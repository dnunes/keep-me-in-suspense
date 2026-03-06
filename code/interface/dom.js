// =============================================================================
// Shared DOM helpers - imported by interface pages (popup, sidepanel).
// Not available in the background service worker.
// =============================================================================


export const DOM = {
  get(id) { return document.getElementById(id); },
  show(el) { el.classList.remove('hidden'); },
  hide(el) { el.classList.add('hidden'); },
  toggle(el, visible) { el.classList.toggle('hidden', !visible); },
  bindEnter(id, fn) {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') { fn(); }
    });
  }
};
