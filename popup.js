/**
 * Redone - Extension Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const statTotal = document.getElementById('stat-total');
  const statToday = document.getElementById('stat-today');
  const statX = document.getElementById('stat-x');
  const statOpen = document.getElementById('stat-open');
  const historyCount = document.getElementById('history-count');

  const toggleHideOnX = document.getElementById('setting-hide-on-x');
  const toggleHideOnOpen = document.getElementById('setting-hide-on-open');
  const toggleHideNewTab = document.getElementById('setting-hide-new-tab');
  const toggleShowToast = document.getElementById('setting-show-toast');
  const selectHideStyle = document.getElementById('setting-hide-style');

  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  const historyList = document.getElementById('history-list');
  const searchInput = document.getElementById('search-input');

  const btnExport = document.getElementById('btn-export');
  const btnImportTrigger = document.getElementById('btn-import-trigger');
  const fileImport = document.getElementById('file-import');
  const btnClearHistory = document.getElementById('btn-clear-history');

  const clearModal = document.getElementById('clear-modal');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');

  function localDate() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  let currentSettings = {};
  let currentHiddenPosts = {};
  let currentStats = {};

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // -------------------------------------------------------------------------
  // Data Loading & Rendering
  // -------------------------------------------------------------------------
  async function loadData() {
    const data = await chrome.storage.local.get(['settings', 'hidden_posts', 'stats']);
    currentSettings = data.settings || {};
    currentHiddenPosts = data.hidden_posts || {};
    currentStats = data.stats || {};

    renderStats();
    renderSettings();
    renderHistory();
  }

  function renderStats() {
    const today = localDate();
    const total = Object.keys(currentHiddenPosts).length;
    const todayCount = (currentStats.todayDate === today) ? (currentStats.todayHidden || 0) : 0;

    statTotal.textContent = total;
    statToday.textContent = todayCount;
    statX.textContent = currentStats.hiddenByX || 0;
    statOpen.textContent = currentStats.hiddenByOpen || 0;
    historyCount.textContent = total;
  }

  function renderSettings() {
    toggleHideOnX.checked = currentSettings.hideOnX !== false;
    toggleHideOnOpen.checked = currentSettings.hideOnOpen !== false;
    toggleHideNewTab.checked = currentSettings.hideOnNewTab !== false;
    toggleShowToast.checked = currentSettings.showToast !== false;
    selectHideStyle.value = currentSettings.hideStyle || 'collapse';
  }

  function renderHistory(query = '') {
    const keys = Object.keys(currentHiddenPosts);
    if (keys.length === 0) {
      historyList.innerHTML = `<div class="empty-state">No hidden posts yet. Browse Reddit and click ✕ or open posts to start!</div>`;
      return;
    }

    // Sort newest first
    const sorted = keys.map(id => ({ id, ...currentHiddenPosts[id] }))
      .sort((a, b) => (b.t || 0) - (a.t || 0));

    const filterText = query.trim().toLowerCase();
    const filtered = filterText
      ? sorted.filter(item => (item.title && item.title.toLowerCase().includes(filterText)) ||
                              (item.s && item.s.toLowerCase().includes(filterText)))
      : sorted;

    if (filtered.length === 0) {
      historyList.innerHTML = `<div class="empty-state">No posts matched "${escapeHtml(filterText)}"</div>`;
      return;
    }

    historyList.innerHTML = '';
    // Show top 50 in popup for performance
    const toShow = filtered.slice(0, 50);

    toShow.forEach(item => {
      const card = document.createElement('div');
      card.className = 'history-card';

      const isX = item.r === 'x_button';
      const badgeClass = isX ? 'badge-x' : 'badge-open';
      const badgeText = isX ? '✕ Dismissed' : '📖 Opened';

      card.innerHTML = `
        <div class="history-content">
          <div class="history-meta">
            <span class="badge-tag ${badgeClass}">${badgeText}</span>
            ${item.s ? `<span class="subreddit-tag">${escapeHtml(item.s)}</span>` : ''}
            <span class="time-tag">${formatRelativeTime(item.t)}</span>
          </div>
          <div class="history-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title || item.id)}</div>
        </div>
        <button type="button" class="unhide-btn" data-id="${escapeHtml(item.id)}" title="Unhide this post">Restore</button>
      `;

      card.querySelector('.unhide-btn').addEventListener('click', async (e) => {
        const idToUnhide = e.target.getAttribute('data-id');
        await unhidePost(idToUnhide);
      });

      historyList.appendChild(card);
    });
  }

  async function unhidePost(id) {
    if (!id) return;
    delete currentHiddenPosts[id];
    await chrome.storage.local.set({ hidden_posts: currentHiddenPosts });
    renderStats();
    renderHistory(searchInput.value);
  }

  // -------------------------------------------------------------------------
  // Settings Change Handlers
  // -------------------------------------------------------------------------
  async function updateSetting(key, value) {
    currentSettings[key] = value;
    await chrome.storage.local.set({ settings: currentSettings });
  }

  toggleHideOnX.addEventListener('change', () => updateSetting('hideOnX', toggleHideOnX.checked));
  toggleHideOnOpen.addEventListener('change', () => updateSetting('hideOnOpen', toggleHideOnOpen.checked));
  toggleHideNewTab.addEventListener('change', () => updateSetting('hideOnNewTab', toggleHideNewTab.checked));
  toggleShowToast.addEventListener('change', () => updateSetting('showToast', toggleShowToast.checked));
  selectHideStyle.addEventListener('change', () => updateSetting('hideStyle', selectHideStyle.value));

  // -------------------------------------------------------------------------
  // Tabs Navigation
  // -------------------------------------------------------------------------
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(`tab-${tabId}`).classList.add('active');

      if (tabId === 'history') {
        renderHistory(searchInput.value);
      }
    });
  });

  // Search filter
  searchInput.addEventListener('input', () => {
    renderHistory(searchInput.value);
  });

  // -------------------------------------------------------------------------
  // Clear History Modal
  // -------------------------------------------------------------------------
  btnClearHistory.addEventListener('click', () => {
    clearModal.classList.add('active');
  });

  modalCancelBtn.addEventListener('click', () => {
    clearModal.classList.remove('active');
  });

  clearModal.addEventListener('click', (e) => {
    if (e.target === clearModal) clearModal.classList.remove('active');
  });

  modalConfirmBtn.addEventListener('click', async () => {
    currentHiddenPosts = {};
    const todayDate = localDate();
    currentStats = {
      totalHidden: 0,
      hiddenByX: 0,
      hiddenByOpen: 0,
      todayHidden: 0,
      todayDate: todayDate
    };

    await chrome.storage.local.set({
      hidden_posts: {},
      stats: currentStats
    });

    clearModal.classList.remove('active');
    renderStats();
    renderHistory();
  });

  // -------------------------------------------------------------------------
  // Export & Import
  // -------------------------------------------------------------------------
  btnExport.addEventListener('click', () => {
    const exportData = {
      app: 'Redone',
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      settings: currentSettings,
      hidden_posts: currentHiddenPosts
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `redone-hidden-posts-${localDate()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  btnImportTrigger.addEventListener('click', () => {
    fileImport.click();
  });

  fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported && imported.hidden_posts && typeof imported.hidden_posts === 'object' && !Array.isArray(imported.hidden_posts)) {
          const clean = {};
          for (const [id, v] of Object.entries(imported.hidden_posts)) {
            if (!/^[a-z0-9]{4,10}$/i.test(id) || !v || typeof v !== 'object') continue;
            clean[id.toLowerCase()] = {
              t: Number(v.t) || Date.now(),
              title: String(v.title || '').slice(0, 150),
              s: String(v.s || '').slice(0, 60),
              permalink: String(v.permalink || '').slice(0, 300),
              r: v.r === 'x_button' ? 'x_button' : 'opened'
            };
          }
          imported.hidden_posts = clean;
          currentHiddenPosts = { ...currentHiddenPosts, ...clean };
          if (imported.settings) {
            currentSettings = { ...currentSettings, ...imported.settings };
          }
          await chrome.storage.local.set({
            hidden_posts: currentHiddenPosts,
            settings: currentSettings
          });
          renderStats();
          renderSettings();
          renderHistory(searchInput.value);
          alert(`Successfully imported ${Object.keys(imported.hidden_posts).length} hidden posts!`);
        } else {
          alert('Invalid Redone backup file format.');
        }
      } catch (err) {
        alert('Failed to parse JSON file.');
      }
      fileImport.value = '';
    };
    reader.readAsText(file);
  });

  // Load initial data
  await loadData();
});
