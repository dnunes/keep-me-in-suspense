import { Utils, CONFIG_KEYS } from '../../scripts/utils.js';
import { DOM } from '../dom.js';

// =============================================================================
// Storage
// =============================================================================

const Storage = {
  _config: {
    settings: {},
    activationRules: [],
    whitelistRules: [],
    mediaRules: []
  },

  async load() {
    const data = await chrome.storage.sync.get([
      'settings',
      'activationRules',
      'whitelistRules',
      'mediaRules'
    ]);
    Storage._config = {
      settings: data.settings ?? {},
      activationRules: data.activationRules ?? [],
      whitelistRules: data.whitelistRules ?? [],
      mediaRules: data.mediaRules ?? []
    };
  },

  get() {
    return Storage._config;
  },

  async save(patch) {
    Object.assign(Storage._config, patch);
    await chrome.storage.sync.set(patch);
  }
};

// =============================================================================
// Groups
// =============================================================================

const Groups = {
  async query() {
    const groups = await chrome.tabGroups.query({});
    return groups.filter(g => g.title && g.title.trim() !== '');
  }
};

// =============================================================================
// Helpers
// =============================================================================

function makeRuleRowBase(rule, templateId, deleteAction) {
  const li = DOM.get(templateId).content.cloneNode(true).firstElementChild;
  if (rule.broken) {
    li.classList.add('rule-broken');
    li.querySelector('.js-broken').classList.remove('hidden');
  }
  li.querySelector('.js-type').textContent =
    rule.type === 'urlPattern' ? 'URL' : 'Group';
  li.querySelector('.js-label').textContent =
    rule.type === 'urlPattern' ? rule.value : rule.groupTitle;
  li.querySelector('.js-delete').addEventListener('click', deleteAction);
  return li;
}

// =============================================================================
// UI - renders all sections from current config
// =============================================================================

const UI = {
  refresh() {
    const { settings, activationRules, whitelistRules, mediaRules } =
      Storage.get();
    UI.renderSettings(settings);
    UI.renderActivationRules(activationRules);
    UI.renderWhitelistRules(whitelistRules);
    UI.renderMediaRules(mediaRules);
  },

  renderSettings(settings) {
    DOM.get('masterEnabled').checked = settings.enabled ?? true;
    DOM.get('suspensionMode').value =
      settings.suspensionMode ?? 'replace';
    DOM.get('neverSuspendPinned').checked =
      settings.neverSuspendPinned ?? false;
  },

  renderActivationRules(rules) {
    const list = DOM.get('activationList');
    const empty = DOM.get('activationEmpty');
    list.innerHTML = '';
    DOM.toggle(empty, rules.length === 0);
    for (const rule of rules) {
      list.appendChild(UI.makeActivationRow(rule));
    }
  },

  renderWhitelistRules(rules) {
    const list = DOM.get('whitelistList');
    const empty = DOM.get('whitelistEmpty');
    list.innerHTML = '';
    DOM.toggle(empty, rules.length === 0);
    for (const rule of rules) {
      list.appendChild(UI.makeWhitelistRow(rule));
    }
  },

  renderMediaRules(rules) {
    const list = DOM.get('mediaList');
    const empty = DOM.get('mediaEmpty');
    list.innerHTML = '';
    DOM.toggle(empty, rules.length === 0);
    for (const rule of rules) {
      list.appendChild(UI.makeMediaRow(rule));
    }
  },

  makeActivationRow(rule) {
    const li = makeRuleRowBase(rule, 'activationRuleTpl',
      () => Actions.deleteActivationRule(rule.id));
    li.querySelector('.js-delay').textContent = Utils.formatDelay(rule.delay);
    return li;
  },

  makeWhitelistRow(rule) {
    const li = makeRuleRowBase(rule, 'whitelistRuleTpl',
      () => Actions.deleteWhitelistRule(rule.id));
    if (rule.onlyWhenAudible) {
      li.querySelector('.js-audible').classList.remove('hidden');
    }
    return li;
  },

  makeMediaRow(rule) {
    const li = DOM.get('mediaRuleTpl').content
      .cloneNode(true).firstElementChild;

    li.querySelector('.js-label').textContent = rule.domain;
    li.querySelector('.js-delete').addEventListener('click', () =>
      Actions.deleteMediaRule(rule.id)
    );
    return li;
  }
};

// =============================================================================
// Actions - config mutations
// =============================================================================

const Actions = {
  async saveSettings() {
    await Storage.save({
      settings: {
        enabled: DOM.get('masterEnabled').checked,
        suspensionMode: DOM.get('suspensionMode').value,
        neverSuspendPinned: DOM.get('neverSuspendPinned').checked
      }
    });
  },

  async deleteActivationRule(id) {
    const { activationRules } = Storage.get();
    await Storage.save({
      activationRules: activationRules.filter(r => r.id !== id)
    });
    UI.refresh();
  },

  async deleteWhitelistRule(id) {
    const { whitelistRules } = Storage.get();
    await Storage.save({
      whitelistRules: whitelistRules.filter(r => r.id !== id)
    });
    UI.refresh();
  },

  async deleteMediaRule(id) {
    const { mediaRules } = Storage.get();
    await Storage.save({
      mediaRules: mediaRules.filter(r => r.id !== id)
    });
    UI.refresh();
  }
};

// =============================================================================
// Forms - inline add-rule forms
// =============================================================================

const Forms = {
  async populateGroupDatalist(inputEl, datalistEl, noGroupsEl) {
    const groups = await Groups.query();
    datalistEl.innerHTML = '';
    for (const g of groups) {
      const opt = document.createElement('option');
      opt.value = g.title;
      datalistEl.appendChild(opt);
    }
    DOM.show(inputEl);
    DOM.toggle(noGroupsEl, groups.length === 0);
  },

  validatePattern(value) {
    if (!value.trim()) { return 'Pattern cannot be empty.'; }
    if (!value.includes('://')) { return 'Pattern must contain "://"'; }
    return null;
  },

  validateDomain(value) {
    const v = value.trim();
    if (!v) { return 'Domain cannot be empty.'; }
    if (v.includes('://')) { return 'Enter just the domain, not a full URL.'; }
    if (v.includes(' ')) { return 'Domain cannot contain spaces.'; }
    if (!v.includes('.')) { return 'Enter a valid domain (e.g. youtube.com).'; }
    return null;
  },

  openActivation() {
    Forms.closeWhitelist();
    Forms.closeMedia();
    const patternEl = DOM.get('actPattern');
    DOM.get('actType').value = 'urlPattern';
    patternEl.value = '';
    DOM.show(patternEl);
    DOM.get('actGroup').value = '';
    DOM.hide(DOM.get('actGroup'));
    DOM.hide(DOM.get('actNoGroups'));
    DOM.get('actDelay').value = '5';
    DOM.hide(DOM.get('actError'));
    DOM.show(DOM.get('activationForm'));
    patternEl.focus();
  },

  closeActivation() {
    DOM.hide(DOM.get('activationForm'));
  },

  async buildRule(type, patternId, groupId, errorEl, extraFields = {}) {
    if (type === 'urlPattern') {
      const val = DOM.get(patternId).value.trim();
      const err = Forms.validatePattern(val);
      if (err) {
        errorEl.textContent = err;
        DOM.show(errorEl);
        return null;
      }
      return { id: crypto.randomUUID(), type: 'urlPattern', value: val, ...extraFields };
    } else {
      const title = DOM.get(groupId).value.trim();
      if (!title) {
        errorEl.textContent = 'Please enter a group name.';
        DOM.show(errorEl);
        return null;
      }
      const groups = await Groups.query();
      const match = groups.find(g => g.title === title);
      return {
        id: crypto.randomUUID(),
        type: 'chromeGroup',
        groupId: match ? match.id : -1,
        groupTitle: title,
        broken: !match,
        ...extraFields
      };
    }
  },

  async submitActivation() {
    const errorEl = DOM.get('actError');
    const rule = await Forms.buildRule(
      DOM.get('actType').value, 'actPattern', 'actGroup', errorEl,
      { delay: Forms.parseDelay('actDelay') }
    );
    if (!rule) { return; }

    const { activationRules } = Storage.get();
    const isDupe = rule.type === 'urlPattern'
      ? activationRules.some(r => r.type === 'urlPattern' && r.value === rule.value)
      : activationRules.some(r => r.type === 'chromeGroup' && r.groupTitle === rule.groupTitle);
    if (!isDupe) { await Storage.save({ activationRules: [...activationRules, rule] }); }
    Forms.closeActivation();
    UI.refresh();
  },

  openWhitelist() {
    Forms.closeActivation();
    Forms.closeMedia();
    const patternEl = DOM.get('wlPattern');
    DOM.get('wlType').value = 'urlPattern';
    patternEl.value = '';
    DOM.show(patternEl);
    DOM.get('wlGroup').value = '';
    DOM.hide(DOM.get('wlGroup'));
    DOM.hide(DOM.get('wlNoGroups'));
    DOM.get('wlAudible').checked = false;
    DOM.hide(DOM.get('wlError'));
    DOM.show(DOM.get('whitelistForm'));
    patternEl.focus();
  },

  closeWhitelist() {
    DOM.hide(DOM.get('whitelistForm'));
  },

  async submitWhitelist() {
    const errorEl = DOM.get('wlError');
    const audible = DOM.get('wlAudible').checked;
    const rule = await Forms.buildRule(
      DOM.get('wlType').value, 'wlPattern', 'wlGroup', errorEl,
      { onlyWhenAudible: audible }
    );
    if (!rule) { return; }

    const { whitelistRules } = Storage.get();
    const isDupe = rule.type === 'urlPattern'
      ? whitelistRules.some(r => r.type === 'urlPattern' && r.value === rule.value && r.onlyWhenAudible === rule.onlyWhenAudible)
      : whitelistRules.some(r => r.type === 'chromeGroup' && r.groupTitle === rule.groupTitle && r.onlyWhenAudible === rule.onlyWhenAudible);
    if (!isDupe) { await Storage.save({ whitelistRules: [...whitelistRules, rule] }); }
    Forms.closeWhitelist();
    UI.refresh();
  },

  openMedia() {
    Forms.closeActivation();
    Forms.closeWhitelist();
    DOM.get('mediaDomain').value = '';
    DOM.hide(DOM.get('mediaError'));
    DOM.show(DOM.get('mediaForm'));
    DOM.get('mediaDomain').focus();
  },

  closeMedia() {
    DOM.hide(DOM.get('mediaForm'));
  },

  async submitMedia() {
    const errorEl = DOM.get('mediaError');
    const raw = DOM.get('mediaDomain').value.trim();
    const err = Forms.validateDomain(raw);
    if (err) {
      errorEl.textContent = err;
      DOM.show(errorEl);
      return;
    }

    // Auto-prefix wildcard for root domains (no subdomain - at most one dot)
    const parts = raw.split('.');
    const domain = parts.length <= 2 ? '*.'+ raw : raw;

    const { mediaRules } = Storage.get();
    if (!mediaRules.some(r => r.domain === domain)) {
      await Storage.save({
        mediaRules: [...mediaRules, { id: crypto.randomUUID(), domain }]
      });
    }
    Forms.closeMedia();
    UI.refresh();
  },

  parseDelay(inputId) {
    const raw = parseInt(DOM.get(inputId).value, 10);
    return Math.max(1, isNaN(raw) ? 5 : raw) * 60;
  }
};

// =============================================================================
// Event wiring
// =============================================================================

DOM.get('unsuspendAllBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'UNSUSPEND_ALL' });
});

DOM.get('masterEnabled')
  .addEventListener('change', Actions.saveSettings);
DOM.get('suspensionMode')
  .addEventListener('change', Actions.saveSettings);
DOM.get('neverSuspendPinned')
  .addEventListener('change', Actions.saveSettings);

DOM.get('addActivationBtn')
  .addEventListener('click', Forms.openActivation);
DOM.get('actSave')
  .addEventListener('click', Forms.submitActivation);
DOM.get('actCancel')
  .addEventListener('click', Forms.closeActivation);

DOM.get('actType').addEventListener('change', async () => {
  const isUrl = DOM.get('actType').value === 'urlPattern';
  DOM.toggle(DOM.get('actPattern'), isUrl);
  if (!isUrl) {
    DOM.get('actGroup').value = '';
    await Forms.populateGroupDatalist(
      DOM.get('actGroup'),
      DOM.get('actGroupList'),
      DOM.get('actNoGroups')
    );
  } else {
    DOM.hide(DOM.get('actGroup'));
    DOM.hide(DOM.get('actNoGroups'));
  }
});

DOM.get('addWhitelistBtn')
  .addEventListener('click', Forms.openWhitelist);
DOM.get('wlSave')
  .addEventListener('click', Forms.submitWhitelist);
DOM.get('wlCancel')
  .addEventListener('click', Forms.closeWhitelist);

DOM.get('wlType').addEventListener('change', async () => {
  const isUrl = DOM.get('wlType').value === 'urlPattern';
  DOM.toggle(DOM.get('wlPattern'), isUrl);
  if (!isUrl) {
    DOM.get('wlGroup').value = '';
    await Forms.populateGroupDatalist(
      DOM.get('wlGroup'),
      DOM.get('wlGroupList'),
      DOM.get('wlNoGroups')
    );
  } else {
    DOM.hide(DOM.get('wlGroup'));
    DOM.hide(DOM.get('wlNoGroups'));
  }
});

DOM.get('addMediaBtn')
  .addEventListener('click', Forms.openMedia);
DOM.get('mediaSave')
  .addEventListener('click', Forms.submitMedia);
DOM.get('mediaCancel')
  .addEventListener('click', Forms.closeMedia);

DOM.bindEnter('actPattern', Forms.submitActivation);
DOM.bindEnter('actGroup', Forms.submitActivation);
DOM.bindEnter('actDelay', Forms.submitActivation);
DOM.bindEnter('wlPattern', Forms.submitWhitelist);
DOM.bindEnter('wlGroup', Forms.submitWhitelist);
DOM.bindEnter('mediaDomain', Forms.submitMedia);

// Re-render if the background modifies config
// (e.g. a tab group is renamed or marked broken)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') { return; }
  if (!Object.keys(changes).some(k => CONFIG_KEYS.has(k))) { return; }
  Storage.load().then(() => UI.refresh());
});

// =============================================================================
// Init
// =============================================================================

async function init() {
  Forms.closeActivation();
  Forms.closeWhitelist();
  Forms.closeMedia();
  await Storage.load();
  UI.refresh();
}

init();
