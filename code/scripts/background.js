import { Utils, CONFIG_KEYS, RuleEngine } from './utils.js';

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_SETTINGS = {
  enabled: true,
  suspensionMode: 'replace', // 'replace' | 'discard'
  neverSuspendPinned: false
};

const DEFAULT_MEDIA_DOMAINS = [
  '*.youtube.com',
  '*.twitch.tv',
  '*.netflix.com',
  '*.spotify.com',
  '*.primevideo.com',
  '*.disneyplus.com',
  '*.vimeo.com',
  '*.soundcloud.com'
];

// =============================================================================
// Config
// =============================================================================

const Config = {
  async get() {
    return chrome.storage.sync.get([
      'settings',
      'activationRules',
      'whitelistRules',
      'mediaRules'
    ]);
  }
};

// =============================================================================
// LastActivity - in-memory map of tabId -> lastActiveTimestamp (ms)
// =============================================================================

const LastActivity = {
  _map: new Map(),

  record(tabId) { LastActivity._map.set(tabId, Date.now()); },
  get(tabId) { return LastActivity._map.get(tabId); },
  delete(tabId) { LastActivity._map.delete(tabId); },
  seed(tabs) {
    for (const tab of tabs) {
      if (!LastActivity._map.has(tab.id)) { LastActivity._map.set(tab.id, Date.now()); }
    }
  }
};

// =============================================================================
// TabRuleCache - in-memory map of tabId -> { url, activationRule, whitelisted }
// Rebuilt eagerly on config changes; entries invalidated on relevant tab events.
// =============================================================================

const TabRuleCache = {
  _map: new Map(),

  get(tabId) { return TabRuleCache._map.get(tabId); },

  set(tabId, tab, config) {
    TabRuleCache._map.set(tabId, {
      url: tab.url,
      activationRule: RuleEngine.getActivationRule(tab, config),
      whitelisted: RuleEngine.getWhitelistStatus(tab, config) !== null
    });
  },

  delete(tabId) { TabRuleCache._map.delete(tabId); },
  entries() { return TabRuleCache._map.entries(); },

  async rebuild() {
    const [config, tabs] = await Promise.all([
      Config.get(),
      chrome.tabs.query({})
    ]);
    TabRuleCache._map.clear();
    for (const tab of tabs) {
      if (!Utils.isSuspendableUrl(tab.url)) { continue; }
      TabRuleCache.set(tab.id, tab, config);
    }
  }
};

// =============================================================================
// Suspension
// =============================================================================

const Suspension = {
  async _captureThumbnail(tab) {
    const target = { tabId: tab.id };
    try {
      await chrome.debugger.attach(target, '1.3');
      try {
        const { data } = await chrome.debugger.sendCommand(
          target, 'Page.captureScreenshot', { format: 'jpeg', quality: 60 }
        );
        return 'data:image/jpeg;base64,'+ data;
      } finally {
        await chrome.debugger.detach(target);
      }
    } catch (e) {
      console.error('[ils] _captureThumbnail failed:', e);
      return null;
    }
  },

  async _doSuspend(tab, settings) {
    TabRuleCache.delete(tab.id);
    LastActivity.delete(tab.id);

    if (settings.suspensionMode === 'discard') {
      await chrome.tabs.discard(tab.id);
      return;
    }

    const thumbnail = await Suspension._captureThumbnail(tab);
    if (thumbnail) {
      await chrome.storage.session.set({
        [`thumb_${tab.id}`]: thumbnail
      });
    }

    const params = new URLSearchParams({
      url: tab.url,
      title: tab.title ?? '',
      favicon: tab.favIconUrl ?? '',
      suspendedAt: String(Date.now())
    });
    await chrome.tabs.update(tab.id, {
      url: chrome.runtime.getURL('code/interface/suspended/index.html')
        +'#'+ params.toString()
    });
  },

  async suspend(tabId, settings, force = false) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      TabRuleCache.delete(tabId);
      LastActivity.delete(tabId);
      return;
    }

    if (!force) {
      // Final live whitelist check - tab state may have changed since cache build
      const config = await Config.get();
      if (RuleEngine.getWhitelistStatus(tab, config) !== null) { return; }
    }

    await Suspension._doSuspend(tab, settings);
  }
};

// =============================================================================
// GroupSync - tab group rename tracking and broken-rule detection
// =============================================================================

const GroupSync = {
  // Loads both rule arrays, calls fn(rule) for every tabGroup rule,
  // then saves back to storage if any rule was changed or deleted.
  // fn return values: true = modified, false = no change, null = delete rule.
  async _applyToGroupRules(fn) {
    const { activationRules = [], whitelistRules = [] } = await Config.get();
    let dirty = false;

    //this function filters out unrecoverable broken rules as well as checking for changes
    const _checkDirty = function (rule) {
      if (rule.type !== 'tabGroup') { return true; }
      const result = fn(rule);
      if (result === null) { dirty = true; return false; }
      if (result) { dirty = true; }
      return true;
    }
    const newActivationRules = activationRules.filter(_checkDirty);
    const newWhitelistRules  = whitelistRules.filter(_checkDirty);

    if (dirty) { await chrome.storage.sync.set({ activationRules: newActivationRules, whitelistRules: newWhitelistRules }); }
  },

  async fixGroupRules() {
    const allGroups = await chrome.tabGroups.query({});
    await GroupSync._applyToGroupRules(GroupSync._fixGroupRules.bind(null, allGroups));
  },
  _fixGroupRules(allGroups, rule) {
    const groupIDExists = allGroups.some(g => g.id === rule.groupId);
    if (groupIDExists) {
      if (rule.broken) { rule.broken = false; return true; } //not broken anymore :)
      return false;
    } else { //no group ID, check by title.
      if (!rule.groupTitle) { return null; } // no title - unrecoverable, delete the rule
      const matches = allGroups.filter(g => g.title === rule.groupTitle);
      if (matches.length === 1) { //found the rule! Fixed (new Group ID)
        rule.groupId = matches[0].id; rule.broken = false;
      }
      else { rule.broken = true; }
      return true;
    }
  },

  async onCreated(group) {
    if (!group.title) { return; }
    await GroupSync._applyToGroupRules(GroupSync._onCreated.bind(null, group));
  },
  _onCreated(group, rule) {
    if (!rule.broken || rule.groupTitle !== group.title) { return false; }
    rule.groupId = group.id;
    rule.broken = false;
    return true;
  },

  async onUpdated(group) {
    await GroupSync._applyToGroupRules(GroupSync._onUpdated.bind(null, group));
  },
  _onUpdated(group, rule) {
    if (rule.groupId !== group.id) { return false; }
    let changed = false;
    if (rule.groupTitle !== group.title) { rule.groupTitle = group.title; changed = true; }
    if (rule.broken) { rule.broken = false; changed = true; }
    return changed;
  },

  async onRemoved(groupId) {
    await GroupSync._applyToGroupRules(GroupSync._onRemoved.bind(null, groupId));
  },
  _onRemoved(groupId, rule) {
    if (rule.groupId !== groupId || rule.broken) { return false; }
    if (!rule.groupTitle) { return null; } // no title - unrecoverable, delete the rule
    rule.broken = true;
    return true;
  }
};

// =============================================================================
// ContextMenu
// =============================================================================

const ContextMenu = {
  async setup() {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: 'toggle-suspend-tab', title: 'Suspend current tab', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'sep-window', type: 'separator', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'suspend-others-window',title: 'Suspend others (this window)', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'suspend-all-window', title: 'Suspend all (this window)', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'unsuspend-all-window', title: 'Unsuspend all (this window)', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'sep-all', type: 'separator', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'suspend-others-all', title: 'Suspend others (all windows)', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'suspend-all-all', title: 'Suspend all (all windows)', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'unsuspend-all', title: 'Unsuspend all (all windows)', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'sep-config', type: 'separator', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-config', title: 'Configuration', contexts: ['action'] });
  },

  async update() {
    const [[activeTab], allTabs] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.tabs.query({})
    ]);

    const windowTabs   = activeTab ? allTabs.filter(t => t.windowId === activeTab.windowId) : [];
    const otherWindow  = windowTabs.filter(t => !t.active);
    const otherAll     = allTabs.filter(t => !t.active);

    const tabIsSuspended = activeTab && Utils.isSuspendedPage(activeTab.url);
    const tabIsSuspendableUrl = activeTab && Utils.isSuspendableUrl(activeTab.url);

    const isSuspendable = t =>
      Utils.isSuspendableUrl(t.url) &&
      !Utils.isSuspendedPage(t.url) &&
      !TabRuleCache.get(t.id)?.whitelisted;

    chrome.contextMenus.update('toggle-suspend-tab', { title: tabIsSuspended ? 'Unsuspend current tab' : 'Suspend current tab', enabled: tabIsSuspended || tabIsSuspendableUrl });
    chrome.contextMenus.update('suspend-others-window', { enabled: otherWindow.some(isSuspendable) });
    chrome.contextMenus.update('suspend-all-window', { enabled: windowTabs.some(isSuspendable) });
    chrome.contextMenus.update('unsuspend-all-window', { enabled: windowTabs.some(t => Utils.isSuspendedPage(t.url)) });
    chrome.contextMenus.update('suspend-others-all', { enabled: otherAll.some(isSuspendable) });
    chrome.contextMenus.update('suspend-all-all', { enabled: allTabs.some(isSuspendable) });
    chrome.contextMenus.update('unsuspend-all', { enabled: allTabs.some(t => Utils.isSuspendedPage(t.url)) });
  }
};

// =============================================================================
// BulkActions - window-scoped or global tab operations
// Pass windowId to scope to a single window; omit (or null) for all windows.
// =============================================================================

const BulkActions = {
  // Suspends non-active, non-whitelisted tabs.
  async suspendOthers(settings, windowId = null) {
    const query = windowId ? { windowId, active: false } : { active: false };
    const [tabs, config] = await Promise.all([chrome.tabs.query(query), Config.get()]);
    await Promise.all(tabs
      .filter(tab => Utils.isSuspendableUrl(tab.url) && !Utils.isSuspendedPage(tab.url) && RuleEngine.getWhitelistStatus(tab, config) === null)
      .map(tab => Suspension._doSuspend(tab, settings))
    );
  },

  // Suspends all non-whitelisted tabs, including the active one.
  async suspendAll(settings, windowId = null) {
    const query = windowId ? { windowId } : {};
    const [tabs, config] = await Promise.all([chrome.tabs.query(query), Config.get()]);
    await Promise.all(tabs
      .filter(tab => Utils.isSuspendableUrl(tab.url) && !Utils.isSuspendedPage(tab.url) && RuleEngine.getWhitelistStatus(tab, config) === null)
      .map(tab => Suspension._doSuspend(tab, settings))
    );
  },

  // Restores suspended tabs to their original URLs.
  async unsuspendAll(windowId = null) {
    const query = windowId ? { windowId } : {};
    const tabs = await chrome.tabs.query(query);
    for (const tab of tabs) {
      if (!Utils.isSuspendedPage(tab.url)) { continue; }
      const { url } = Utils.parseSuspendedUrl(tab.url);
      if (url) {
        chrome.tabs.update(tab.id, { url });
        chrome.storage.session.remove(`thumb_${tab.id}`);
      }
    }
  }
};

// =============================================================================
// Alarm tick - the suspension loop
// Iterates only the cache; non-matching tabs are never touched.
// =============================================================================

async function onAlarmTick() {
  const config = await Config.get();
  if (!config.settings?.enabled) { return; }

  // Heal broken group rules while the worker is already awake
  const allRules = [
    ...(config.activationRules ?? []),
    ...(config.whitelistRules ?? [])
  ];
  if (allRules.some(r => r.type === 'tabGroup' && r.broken)) {
    await GroupSync.fixGroupRules();
  }

  const now = Date.now();
  const eligible = [];
  for (const [tabId, entry] of TabRuleCache.entries()) {
    if (!entry.activationRule || entry.whitelisted) { continue; }
    if (now - (LastActivity.get(tabId) ?? now) >= entry.activationRule.delay * 1000) {
      eligible.push(tabId);
    }
  }
  Promise.all(eligible.map(tabId => Suspension.suspend(tabId, config.settings))).catch(() => {});
}

// =============================================================================
// Tab event handlers
// =============================================================================

const CACHE_INVALIDATING_PROPS = ['url', 'groupId', 'audible', 'pinned'];

async function onTabUpdated(tabId, changeInfo, tab) {
  if (changeInfo.url) {
    LastActivity.record(tabId);
    if (tab.active) { ContextMenu.update().catch(() => {}); }
    // Clean up session data when navigating away from a suspended page.
    // Guard against the opposite case: when we ARE suspending, changeInfo.url
    // points to our suspended page - we must not delete the entry we just wrote.
    if (!Utils.isSuspendedPage(changeInfo.url)) {
      chrome.storage.session.remove(`thumb_${tabId}`);
    }
  }

  // If a tab just joined a group, try to heal any broken rule for that group.
  // This covers the case where tabGroups.onCreated was missed (worker was asleep).
  if (changeInfo.groupId > 0) {
    try {
      const group = await chrome.tabGroups.get(changeInfo.groupId);
      await GroupSync.onCreated(group);
    } catch { /* group may already be gone */ }
  }

  if (CACHE_INVALIDATING_PROPS.some(p => p in changeInfo)) {
    if (!Utils.isSuspendableUrl(tab.url)) {
      TabRuleCache.delete(tabId);
      return;
    }
    const config = await Config.get();
    TabRuleCache.set(tabId, tab, config);
  }

}

// Registered as a separate onUpdated listener so its sole purpose - injecting
// into pages - is immediately visible to anyone reviewing what the extension
// does to other tabs.
async function injectSuspense(tabId, changeInfo, tab) {
  if (changeInfo.status !== 'complete') { return; }

  if (!Utils.isSuspendableUrl(tab.url)) { return; }
  if (!TabRuleCache.get(tab.id)?.activationRule) { return; }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['code/scripts/injected.js'],
      injectImmediately: false
    });
  } catch { /* Tab may not be injectable (PDF viewer, chrome:// pages, etc.) */ }
}

function onTabActivated({ tabId }) {
  LastActivity.record(tabId);
  ContextMenu.update().catch(() => {});
}

function onTabRemoved(tabId) {
  TabRuleCache.delete(tabId);
  LastActivity.delete(tabId);
  chrome.storage.session.remove(`thumb_${tabId}`);
}

// =============================================================================
// Storage change handler - eager cache rebuild on config save
// =============================================================================

let _rebuildTimer = null;

const CACHE_REBUILD_DEBOUNCE_INTERVAL = 100;
function onStorageChanged(changes, area) {
  if (area !== 'sync') { return; }
  if (!Object.keys(changes).some(k => CONFIG_KEYS.has(k))) { return; }
  clearTimeout(_rebuildTimer);
  _rebuildTimer = setTimeout(() => TabRuleCache.rebuild(), CACHE_REBUILD_DEBOUNCE_INTERVAL);
}

// =============================================================================
// Message handler
// =============================================================================

function onMessage(message, sender) {
  if (message.type === 'USER_ACTIVITY' && sender.tab?.id != null) {
    LastActivity.record(sender.tab.id);
  }
  if (message.type === 'SUSPEND_TAB' && message.tabId != null) {
    Config.get().then(({ settings }) => Suspension.suspend(message.tabId, settings, true));
  }
  if (message.type === 'BULK_ACTION') {
    const windowId = message.windowId ?? null;
    Config.get().then(({ settings }) => {
      if (message.action === 'suspendOthers') { return BulkActions.suspendOthers(settings, windowId); }
      if (message.action === 'suspendAll') { return BulkActions.suspendAll(settings, windowId); }
      if (message.action === 'unsuspendAll') { return BulkActions.unsuspendAll(windowId).then(() => ContextMenu.update()); }
    }).catch(() => {});
  }
}

// =============================================================================
// Initialisation
// =============================================================================

async function init() {
  await GroupSync.fixGroupRules();
  // Seed activity before rebuilding cache so every tab starts with a fresh
  // timestamp. resolveGroupRules() may trigger onStorageChanged -> Cache.rebuild()
  // asynchronously; we call rebuild() explicitly here to ensure it always runs
  // with fully resolved group IDs.
  const tabs = await chrome.tabs.query({});
  LastActivity.seed(tabs);
  await TabRuleCache.rebuild();
  await ContextMenu.setup();
  await ContextMenu.update();
  chrome.alarms.create('suspense-tick', { periodInMinutes: 1 });
}

// =============================================================================
// First install - write defaults to storage
// =============================================================================

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') { return; }
  await chrome.storage.sync.set({
    settings: DEFAULT_SETTINGS,
    activationRules: [],
    whitelistRules: [],
    mediaRules: DEFAULT_MEDIA_DOMAINS.map((d, i) => ({
      id: 'default-media-'+ i,
      domain: d
    }))
  });
});

// =============================================================================
// Side panel - open on toolbar button click
// =============================================================================

// Disable auto-open so the default_popup can handle the toolbar click instead.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

// =============================================================================
// Event listeners
// =============================================================================

chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === 'suspense-tick') { onAlarmTick(); }
});

chrome.tabs.onUpdated.addListener(onTabUpdated);
chrome.tabs.onUpdated.addListener(injectSuspense);
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onRemoved.addListener(onTabRemoved);

chrome.tabGroups.onCreated.addListener(group => GroupSync.onCreated(group));
chrome.tabGroups.onUpdated.addListener(group => GroupSync.onUpdated(group));
chrome.tabGroups.onRemoved.addListener(({ id }) => GroupSync.onRemoved(id));

chrome.storage.onChanged.addListener(onStorageChanged);
chrome.runtime.onMessage.addListener(onMessage);

const _menuActions = {
  'open-config':           (tab) => chrome.sidePanel.open({ windowId: tab.windowId }),
  'unsuspend-all-window':  (tab) => BulkActions.unsuspendAll(tab.windowId),
  'unsuspend-all':         () => BulkActions.unsuspendAll(),
  'suspend-others-window': (tab, s) => BulkActions.suspendOthers(s, tab.windowId),
  'suspend-all-window':    (tab, s) => BulkActions.suspendAll(s, tab.windowId),
  'suspend-others-all':    (tab, s) => BulkActions.suspendOthers(s),
  'suspend-all-all':       (tab, s) => BulkActions.suspendAll(s),
  'toggle-suspend-tab':    async (tab) => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) { return; }
    if (Utils.isSuspendedPage(activeTab.url)) {
      const { url } = Utils.parseSuspendedUrl(activeTab.url);
      if (url) { await chrome.tabs.update(activeTab.id, { url }); }
    } else if (Utils.isSuspendableUrl(activeTab.url)) {
      const { settings } = await Config.get();
      await Suspension.suspend(activeTab.id, settings, true);
    }
  }
};

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const action = _menuActions[info.menuItemId];
  if (!action) { return; }
  const settings = info.menuItemId.startsWith('suspend-') ? (await Config.get()).settings : undefined;
  await action(tab, settings);
  await ContextMenu.update();
});

chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);
