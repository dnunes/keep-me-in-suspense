import { Utils } from '../../scripts/utils.js';

// =============================================================================
// Params - loads suspension data from session storage
// =============================================================================

const Params = {
  async load() {
    const parsed = Utils.parseSuspendedUrl(location.href);
    if (!parsed.url) { return null; }

    const params = {
      url: parsed.url,
      title: parsed.title,
      favIconUrl: parsed.favicon,
      suspendedAt: parsed.suspendedAt || Date.now()
    };

    // Supplement with thumbnail from session storage (current session only)
    const tab = await chrome.tabs.getCurrent();
    const result = await chrome.storage.session.get(`thumb_${tab.id}`);
    const thumb = result[`thumb_${tab.id}`];
    if (thumb) { params.thumbnail = thumb; }

    return params;
  }
};

// =============================================================================
// UI - builds and mounts the suspended page DOM
// All content is rendered once; nothing runs after init.
// =============================================================================

const UI = {
  setFavicon(favIconUrl) {
    if (!favIconUrl) { return; }
    document.getElementById('favicon').href = favIconUrl;
  },

  formatDatetime(ms) {
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    const date = [
      d.getFullYear(),
      pad(d.getMonth() +1),
      pad(d.getDate())
    ].join('-');
    const time = [
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds())
    ].join(':');
    return `${date} ${time}`;
  },

  render(params) {
    const fragment = document.getElementById('suspendedTpl').content.cloneNode(true);

    if (params.thumbnail) {
      const bg = fragment.querySelector('.js-screenshot');
      bg.style.backgroundImage = `url(${params.thumbnail})`;
      bg.classList.remove('hidden');
    }

    if (params.favIconUrl) {
      const favicon = fragment.querySelector('.js-favicon');
      favicon.src = params.favIconUrl;
      favicon.classList.remove('hidden');
    }

    fragment.querySelector('.js-title').textContent = params.title || params.url;

    const urlEl = fragment.querySelector('.js-url');
    urlEl.href = params.url;
    urlEl.title = params.url;
    urlEl.textContent = params.url;

    fragment.querySelector('.js-at').textContent =
      `Suspended at ${UI.formatDatetime(params.suspendedAt)}`;

    fragment.querySelector('.js-reload')
      .addEventListener('click', () => { window.location.href = params.url; });

    document.getElementById('app').appendChild(fragment);
  },

  renderFallback() {
    const fragment = document.getElementById('fallbackTpl').content.cloneNode(true);
    fragment.querySelector('.js-back')
      .addEventListener('click', () => window.history.back());
    document.getElementById('app').appendChild(fragment);
  }
};

// =============================================================================
// Init
// =============================================================================

async function init() {
  const params = await Params.load();

  if (!params) {
    document.title = '💤 Suspended';
    UI.renderFallback();
    return;
  }

  document.title = `💤 ${params.title || params.url}`;
  UI.setFavicon(params.favIconUrl);
  UI.render(params);
}

init();
