import { Utils, RuleEngine } from '../../scripts/utils.js';
import { DOM } from '../dom.js';

function getTabStatus(tab, config) {
  const ws = RuleEngine.getWhitelistStatus(tab, config);
  if (ws) { return { kind: 'whitelisted', ...ws }; }
  const ruleObj = RuleEngine.getActivationRule(tab, config);
  if (ruleObj) { return { kind: 'active', ruleObj }; }
  return { kind: 'none' };
}

// =============================================================================
// Pattern generation from current tab URL
// =============================================================================

function generatePatterns(url) {
  try {
    const u = new URL(url);
    const { hostname } = u;
    const parts = hostname.split('.');
    const rootDomain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
    const path = u.pathname.replace(/\/$/, '');

    return {
      rootDomain: { pattern: `*://*.${rootDomain}/*`, label: `*.${rootDomain}` },
      hostname: { pattern: `*://${hostname}/*`, label: hostname },
      pathPrefix: path
        ? { pattern: `*://${hostname}${path}*`, label: `${hostname}${path}*` }
        : null,
      exact: path || u.search
        ? { pattern: `*://${hostname}${u.pathname}${u.search}`,
            label: `${hostname}${u.pathname}${u.search}` }
        : null
    };
  } catch {
    return { rootDomain: null, hostname: null, pathPrefix: null, exact: null };
  }
}

function getDelay() {
  return (parseInt(DOM.get('delay').value, 10) || 5) * 60;
}

// =============================================================================
// Render helpers
// =============================================================================

function setupMasterToggle(config) {
  const masterEl = DOM.get('masterEnabled');
  masterEl.checked = config.settings?.enabled ?? true;
  masterEl.addEventListener('change', () => {
    chrome.storage.sync.set({
      settings: { ...(config.settings ?? {}), enabled: masterEl.checked }
    });
  });
}

function resolveEffectiveTab(tab) {
  if (Utils.isSuspendedPage(tab.url)) {
    const { url: originalUrl } = Utils.parseSuspendedUrl(tab.url);
    DOM.show(DOM.get('unsuspendCurrentBtn'));
    DOM.get('unsuspendCurrentBtn').addEventListener('click', () => {
      if (originalUrl) { chrome.tabs.update(tab.id, { url: originalUrl }); }
      window.close();
    });
    if (originalUrl && Utils.isSuspendableUrl(originalUrl)) {
      return { ...tab, url: originalUrl };
    } else {
      DOM.show(DOM.get('noUrlMsg'));
      return null;
    }
  } else {
    DOM.show(DOM.get('suspendBtn'));
    DOM.get('suspendBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SUSPEND_TAB', tabId: tab.id });
      window.close();
    });
    return tab;
  }
}

function renderActiveRule(ruleObj, patterns) {
  const exactPattern = patterns.exact?.pattern;

  DOM.get('activeRuleDelay').textContent = Utils.formatDelay(ruleObj.delay);
  DOM.get('activeRuleName').textContent =
    ruleObj.type === 'urlPattern' ? ruleObj.value : ruleObj.groupTitle;

  if (ruleObj.type === 'chromeGroup') {
    DOM.show(DOM.get('activeRuleGroupTag'));
  }

  // Whitelist option: only when the rule isn't already an exact-page match
  const canWhitelist = exactPattern != null &&
    !(ruleObj.type === 'urlPattern' && ruleObj.value === exactPattern);

  if (canWhitelist) {
    const addBtn = DOM.get('addToWhitelistBtn');
    const inlineForm = DOM.get('whitelistInlineForm');
    const input = DOM.get('whitelistInput');
    const confirmBtn = DOM.get('whitelistConfirmBtn');
    const cancelBtn = DOM.get('whitelistCancelBtn');
    const removeBtn = DOM.get('removeRuleBtn');

    DOM.show(addBtn);
    addBtn.addEventListener('click', () => {
      input.value = exactPattern;
      DOM.hide(addBtn);
      DOM.hide(removeBtn);
      DOM.show(inlineForm);
      input.focus();
      input.select();
    });
    confirmBtn.addEventListener('click', async () => {
      const value = input.value.trim();
      if (!value) { return; }
      const { whitelistRules = [] } = await chrome.storage.sync.get('whitelistRules');
      if (!whitelistRules.some(r => r.type === 'urlPattern' && r.value === value)) {
        whitelistRules.push({
          id: crypto.randomUUID(), type: 'urlPattern',
          value, onlyWhenAudible: false
        });
        await chrome.storage.sync.set({ whitelistRules });
      }
      window.close();
    });
    cancelBtn.addEventListener('click', () => {
      DOM.hide(inlineForm);
      DOM.show(addBtn);
      DOM.show(removeBtn);
    });
    DOM.bindEnter('whitelistInput', () => confirmBtn.click());
  }

  DOM.get('removeRuleBtn').addEventListener('click', async () => {
    const { activationRules = [] } = await chrome.storage.sync.get('activationRules');
    await chrome.storage.sync.set({
      activationRules: activationRules.filter(r => r.id !== ruleObj.id)
    });
    window.close();
  });

  DOM.show(DOM.get('activeRuleSection'));
}

function renderWhitelisted(status) {
  DOM.get('whitelistSummary').textContent =
    status.reason === 'Media player'
      ? 'Media player · will not suspend while playing'
      : `${status.reason} · will never suspend`;
  if (status.rule) {
    DOM.get('statusWhitelistRule').textContent = status.rule;
    DOM.show(DOM.get('whitelistRuleRow'));
  }
  DOM.show(DOM.get('statusWhitelisted'));

  if (status.ruleObj) {
    const removeWhitelistBtn = DOM.get('removeWhitelistBtn');
    DOM.show(removeWhitelistBtn);
    removeWhitelistBtn.addEventListener('click', async () => {
      const { whitelistRules = [] } = await chrome.storage.sync.get('whitelistRules');
      await chrome.storage.sync.set({
        whitelistRules: whitelistRules.filter(r => r.id !== status.ruleObj.id)
      });
      window.close();
    });
  }
}

async function renderNoRule(effectiveTab, config, patterns) {
  DOM.show(DOM.get('statusNone'));
  DOM.show(DOM.get('addSection'));

  const existing = new Set(
    (config.activationRules ?? [])
      .filter(r => r.type === 'urlPattern').map(r => r.value)
  );
  const tpl = DOM.get('patternItemTpl');
  const customRow = DOM.get('p4');

  // Group row - shown first if the tab belongs to a named Chrome group
  if (effectiveTab.groupId > 0) {
    try {
      const group = await chrome.tabGroups.get(effectiveTab.groupId);
      if (group?.title) {
        const li = tpl.content.cloneNode(true).firstElementChild;
        const label = li.querySelector('.pattern-label');
        const icon = li.querySelector('.pattern-icon');
        label.textContent = `${group.title} (All tabs in group)`;
        const alreadyAdded = (config.activationRules ?? [])
          .some(r => r.type === 'chromeGroup' && r.groupId === effectiveTab.groupId);
        if (alreadyAdded) {
          li.classList.add('pattern-added');
          icon.textContent = '✓';
          icon.className = 'pattern-check';
        } else {
          li.addEventListener('click', async () => {
            const { activationRules = [] } = await chrome.storage.sync.get('activationRules');
            if (!activationRules.some(r => r.type === 'chromeGroup' && r.groupId === group.id)) {
              activationRules.push({
                id: crypto.randomUUID(),
                type: 'chromeGroup',
                groupId: group.id,
                groupTitle: group.title,
                broken: false,
                delay: getDelay()
              });
              await chrome.storage.sync.set({ activationRules });
            }
            window.close();
          });
        }
        customRow.before(li);
      }
    } catch { /* group may be gone */ }
  }

  Object.values(patterns).forEach((entry) => {
    if (!entry) { return; }
    const li = tpl.content.cloneNode(true).firstElementChild;
    const label = li.querySelector('.pattern-label');
    const icon = li.querySelector('.pattern-icon');
    label.textContent = entry.label;
    label.title = entry.pattern;
    if (existing.has(entry.pattern)) {
      li.classList.add('pattern-added');
      icon.textContent = '✓';
      icon.className = 'pattern-check';
    } else {
      li.addEventListener('click', async () => {
        const { activationRules = [] } = await chrome.storage.sync.get('activationRules');
        if (!activationRules.some(r => r.value === entry.pattern)) {
          activationRules.push({ id: crypto.randomUUID(), type: 'urlPattern',
            value: entry.pattern, delay: getDelay() });
          await chrome.storage.sync.set({ activationRules });
        }
        window.close();
      });
    }
    customRow.before(li);
  });

  // "Add custom..." row - shows inline form pre-filled with exact page pattern
  const customForm = DOM.get('customInlineForm');
  const customInput = DOM.get('customInput');
  const customConfirm = DOM.get('customConfirmBtn');
  const customCancel = DOM.get('customCancelBtn');
  const fallback = patterns.hostname?.pattern ?? '';

  customRow.addEventListener('click', () => {
    customInput.value = patterns.exact?.pattern ?? fallback;
    DOM.hide(customRow);
    DOM.show(customForm);
    customInput.focus();
    customInput.select();
  });
  customConfirm.addEventListener('click', async () => {
    const value = customInput.value.trim();
    if (!value) { return; }
    const { activationRules = [] } = await chrome.storage.sync.get('activationRules');
    if (!activationRules.some(r => r.value === value)) {
      activationRules.push({ id: crypto.randomUUID(), type: 'urlPattern',
        value, delay: getDelay() });
      await chrome.storage.sync.set({ activationRules });
    }
    window.close();
  });
  customCancel.addEventListener('click', () => {
    DOM.hide(customForm);
    DOM.show(customRow);
  });
  DOM.bindEnter('customInput', () => customConfirm.click());
}

async function setupBulkActions(windowId, config) {
  const [windowTabs, allTabs] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabs.query({})
  ]);

  const otherWindow = windowTabs.filter(t => !t.active);
  const otherAll    = allTabs.filter(t => !t.active);

  const isSuspendable = t =>
    Utils.isSuspendableUrl(t.url) &&
    !Utils.isSuspendedPage(t.url) &&
    RuleEngine.getWhitelistStatus(t, config) === null;

  const groups = {
    window: {
      suspendOthers: { btnId: 'suspendOthersWindowBtn', canDo: otherWindow.some(isSuspendable) },
      suspendAll:    { btnId: 'suspendAllWindowBtn',    canDo: windowTabs.some(isSuspendable)  },
      unsuspendAll:  { btnId: 'unsuspendAllWindowBtn',  canDo: windowTabs.some(t => Utils.isSuspendedPage(t.url)) }
    },
    all: {
      suspendOthers: { btnId: 'suspendOthersAllBtn', canDo: otherAll.some(isSuspendable) },
      suspendAll:    { btnId: 'suspendAllAllBtn',    canDo: allTabs.some(isSuspendable)  },
      unsuspendAll:  { btnId: 'unsuspendAllBtn',     canDo: allTabs.some(t => Utils.isSuspendedPage(t.url)) }
    }
  };

  for (const [scope, actions] of Object.entries(groups)) {
    for (const [action, { btnId, canDo }] of Object.entries(actions)) {
      const btn = DOM.get(btnId);
      btn.disabled = !canDo;
      if (canDo) {
        const msg = { type: 'BULK_ACTION', action };
        if (scope === 'window') { msg.windowId = windowId; }
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage(msg);
          window.close();
        });
      }
    }
  }
}

function setupConfigBtn(windowId) {
  DOM.get('configBtn').addEventListener('click', () => {
    if (windowId) { chrome.sidePanel.open({ windowId }); }
    window.close();
  });
}

// =============================================================================
// Init
// =============================================================================

async function init() {
  const [[tab], config] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.sync.get(['settings', 'activationRules', 'whitelistRules', 'mediaRules'])
  ]);

  setupMasterToggle(config);

  let effectiveTab = null;
  if (!tab || (!Utils.isSuspendableUrl(tab.url) && !Utils.isSuspendedPage(tab.url))) {
    DOM.show(DOM.get('noUrlMsg'));
    DOM.hide(DOM.get('singleActions'));
  } else {
    effectiveTab = resolveEffectiveTab(tab);
  }

  if (effectiveTab) {
    const status = getTabStatus(effectiveTab, config);
    const patterns = generatePatterns(effectiveTab.url);
    if (status.kind === 'active') { renderActiveRule(status.ruleObj, patterns); }
    else if (status.kind === 'whitelisted') { renderWhitelisted(status); }
    else { await renderNoRule(effectiveTab, config, patterns); }
  }

  if (tab?.windowId) { await setupBulkActions(tab.windowId, config); }
  setupConfigBtn(tab?.windowId);
}

init();
