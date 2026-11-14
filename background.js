/**
 * Redone - Reddit Desktop Post Filter & Auto-Hide
 * Background Service Worker
 */

const DEFAULT_SETTINGS = {
  hideOnX: true,
  hideOnOpen: true,
  hideOnNewTab: true,
  showToast: true,
  hideStyle: 'collapse', // 'collapse' | 'dim'
  maxHistory: 20000
};

// Initialize settings and badge on extension installation/update
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const data = await chrome.storage.local.get(['settings', 'stats']);
    if (!data.settings) {
      await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }

    if (!data.stats) {
      const todayDate = (() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
      await chrome.storage.local.set({
        stats: {
          totalHidden: 0,
          hiddenByX: 0,
          hiddenByOpen: 0,
          todayHidden: 0,
          todayDate: todayDate
        }
      });
    }

    // Set badge style
    if (chrome.action && chrome.action.setBadgeBackgroundColor) {
      chrome.action.setBadgeBackgroundColor({ color: '#ff4500' });
    }
  } catch (err) {
    console.warn('[Redone Background] Error during initialization:', err);
  }
});

// Update badge when stats change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) {
    const stats = changes.stats.newValue;
    if (chrome.action && chrome.action.setBadgeText) {
      const count = stats?.todayHidden || 0;
      chrome.action.setBadgeText({
        text: count > 0 ? (count > 999 ? '999+' : String(count)) : ''
      });
    }
  }
});

// Restore today's badge when the browser starts (badge text is not persisted)
async function refreshBadge() {
  try {
    const { stats } = await chrome.storage.local.get('stats');
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const count = stats && stats.todayDate === today ? (stats.todayHidden || 0) : 0;
    await chrome.action.setBadgeBackgroundColor({ color: '#ff4500' });
    await chrome.action.setBadgeText({ text: count > 0 ? (count > 999 ? '999+' : String(count)) : '' });
  } catch (err) {
    console.warn('[Redone Background] Badge refresh failed:', err);
  }
}
chrome.runtime.onStartup.addListener(refreshBadge);
