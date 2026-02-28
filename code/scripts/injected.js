// Double-injection guard - executeScript may be called more than once for the
// same tab (e.g. on rapid navigation or after a cache rebuild). Exit immediately
// if this script is already running in this page context.
if (window.__ilsInjected) {
  throw new Error('already injected');
}
window.__ilsInjected = true;

// =============================================================================
// ActivityReporter
// Throttles USER_ACTIVITY pings to the background. The background alarm fires
// once per minute, so millisecond precision is irrelevant - we just avoid
// flooding the message channel on fast scroll or held-down keys.
// =============================================================================

const ActivityReporter = {
  THROTTLE_MS: 5000,
  _lastReported: 0,

  report() {
    const now = Date.now();
    if (now - ActivityReporter._lastReported < ActivityReporter.THROTTLE_MS) { return; }
    ActivityReporter._lastReported = now;
    try {
      if (!chrome.runtime?.id) { return; }
      chrome.runtime.sendMessage({ type: 'USER_ACTIVITY' }).catch(() => {});
    } catch {
      // Extension context invalidated after a reload - silently stop reporting.
    }
  },
};

// =============================================================================
// Event listeners
// passive: true - promises the browser we won't call preventDefault(), letting
// it handle the event immediately without waiting for our handler to finish.
// scroll uses capture: true to catch scrolling on any element in the page,
// since some pages stop scroll event propagation before it reaches the window.
// =============================================================================

document.addEventListener('click', ActivityReporter.report, { passive: true });
document.addEventListener('keydown', ActivityReporter.report, { passive: true });
document.addEventListener('scroll', ActivityReporter.report, { passive: true, capture: true });
