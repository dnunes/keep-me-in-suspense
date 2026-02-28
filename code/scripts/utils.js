// =============================================================================
// Shared utilities - imported by background.js and interface pages.
// All functions are pure or depend only on the chrome.runtime API.
// =============================================================================

export const CONFIG_KEYS = new Set([
  'settings',
  'activationRules',
  'whitelistRules',
  'mediaRules'
]);

export const Utils = {
  matchesPattern(url, pattern) {
    const normalizedUrl = url.split('#')[0].replace(/\/$/, '');
    const normalizedPattern = pattern.replace(/\/$/, '');
    const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    try {
      return new RegExp('^'+ escaped.replace(/\*/g, '.*') +'$').test(normalizedUrl);
    } catch {
      return false;
    }
  },

  matchesDomain(hostname, domain) {
    if (domain.startsWith('*.')) {
      const base = domain.slice(2);
      return hostname === base || hostname.endsWith('.'+ base);
    }
    return hostname === domain;
  },

  isSuspendedPage(url) {
    return url?.startsWith(chrome.runtime.getURL('code/interface/suspended/'));
  },

  isSuspendableUrl(url) {
    return !!url &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('chrome://') &&
      !Utils.isSuspendedPage(url);
  },

  formatDelay(seconds) {
    const m = Math.round(seconds / 60);
    return m === 1 ? '1 min' : `${m} min`;
  },

  parseSuspendedUrl(url) {
    const hash = url.split('#')[1] ?? '';
    const p = new URLSearchParams(hash);
    return {
      url: p.get('url'),
      title: p.get('title') ?? '',
      favicon: p.get('favicon') ?? '',
      suspendedAt: parseInt(p.get('suspendedAt'), 10) || 0
    };
  }
};

export const RuleEngine = {
  // Returns null if not whitelisted, or { reason, rule, ruleObj? } if whitelisted.
  getWhitelistStatus(tab, config) {
    const { settings, whitelistRules = [], mediaRules = [] } = config;

    if (settings?.neverSuspendPinned && tab.pinned) {
      return { reason: 'Pinned tab', rule: '' };
    }

    for (const rule of whitelistRules) {
      if (rule.onlyWhenAudible && !tab.audible) { continue; }
      if (rule.type === 'urlPattern' &&
          Utils.matchesPattern(tab.url, rule.value)) {
        return { reason: 'Whitelisted', rule: rule.value, ruleObj: rule };
      }
      if (rule.type === 'chromeGroup' &&
          !rule.broken &&
          tab.groupId === rule.groupId) {
        return { reason: 'Whitelisted group', rule: rule.groupTitle, ruleObj: rule };
      }
    }

    if (tab.audible) {
      let hostname;
      try { hostname = new URL(tab.url).hostname; } catch { /* skip */ }
      if (hostname) {
        for (const rule of mediaRules) {
          if (Utils.matchesDomain(hostname, rule.domain)) {
            return { reason: 'Media player', rule: rule.domain };
          }
        }
      }
    }

    return null;
  },

  getActivationRule(tab, config) {
    for (const rule of (config.activationRules ?? [])) {
      if (rule.broken) { continue; }
      if (rule.type === 'urlPattern' &&
          Utils.matchesPattern(tab.url, rule.value)) {
        return rule;
      }
      if (rule.type === 'chromeGroup' && tab.groupId === rule.groupId) {
        return rule;
      }
    }
    return null;
  }
};
