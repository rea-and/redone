/**
 * Redone - Reddit Desktop Post Filter & Auto-Hide
 * Content Script
 */

(function () {
  'use strict';

  // Prevent multiple executions in the same frame
  if (window.__redoneContentScriptLoaded) return;
  window.__redoneContentScriptLoaded = true;

  // ---------------------------------------------------------------------------
  // State & Configuration
  // ---------------------------------------------------------------------------
  const DEFAULT_SETTINGS = {
    hideOnX: true,
    hideOnOpen: true,
    hideOnNewTab: true,
    showToast: true,
    hideStyle: 'collapse', // 'collapse' | 'dim'
    maxHistory: 20000
  };

  function localDate() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  let settings = { ...DEFAULT_SETTINGS };
  let hiddenPostsMap = {};
  const hiddenIdSet = new Set();

  let lastUrl = window.location.href;
  let currentDetailPostId = null;
  let lastHiddenPostInfo = null;
  let toastTimeout = null;

  // ---------------------------------------------------------------------------
  // Normalization & Extraction Helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalizes any post ID into a clean, canonical lowercase ID string.
   * Strips prefixes like 't3_' or 'thing_t3_'.
   */
  function normalizePostId(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const match = raw.match(/comments\/([a-zA-Z0-9]+)/i);
    if (match) return match[1].toLowerCase();
    const clean = raw.replace(/^(thing_)?t3_/, '').trim().toLowerCase();
    return /^[a-z0-9]{4,10}$/i.test(clean) ? clean : null;
  }

  /**
   * Extracts post ID from a DOM node or URL.
   */
  function extractPostId(nodeOrUrl) {
    if (!nodeOrUrl) return null;

    if (typeof nodeOrUrl === 'string') {
      return normalizePostId(nodeOrUrl);
    }

    if (nodeOrUrl.nodeType !== Node.ELEMENT_NODE) return null;

    const el = nodeOrUrl;

    // 1. Check direct attributes: post-id, id, data-fullname
    const direct = el.getAttribute('post-id') ||
      el.getAttribute('data-fullname') ||
      el.getAttribute('id') ||
      el.id;
    const idFromDirect = normalizePostId(direct);
    if (idFromDirect) return idFromDirect;

    // 2. Check permalink attribute
    const permalink = el.getAttribute('permalink');
    if (permalink) {
      const idFromPermalink = normalizePostId(permalink);
      if (idFromPermalink) return idFromPermalink;
    }

    // 3. Check child link elements (title, comments)
    const link = el.querySelector('a[href*="/comments/"]');
    if (link && link.href) {
      const idFromLink = normalizePostId(link.href);
      if (idFromLink) return idFromLink;
    }

    return null;
  }

  /**
   * Extracts post metadata (title, subreddit, permalink) for storage and undo history.
   */
  function extractPostMetadata(postEl, postId) {
    let title = '';
    let subreddit = '';
    let permalink = '';

    if (postEl) {
      title = postEl.getAttribute('post-title') || '';
      if (!title) {
        const titleEl = postEl.querySelector('[slot="title"], h1, h2, h3, a.title, [data-testid="post-title"]');
        if (titleEl) title = titleEl.textContent.trim();
      }

      subreddit = postEl.getAttribute('subreddit-prefixed-name') ||
        postEl.getAttribute('data-subreddit-prefixed') ||
        '';
      if (!subreddit) {
        const subEl = postEl.querySelector('a[href^="/r/"]');
        if (subEl) {
          const href = subEl.getAttribute('href') || '';
          const match = href.match(/\/r\/([^/]+)/i);
          if (match) subreddit = 'r/' + match[1];
        }
      }

      permalink = postEl.getAttribute('permalink') || '';
      if (!permalink) {
        const linkEl = postEl.querySelector('a[href*="/comments/"]');
        if (linkEl) permalink = linkEl.getAttribute('href') || '';
      }
    }

    // Fallback if missing
    if (!title && postId) title = `Reddit Post (${postId})`;
    if (title.length > 150) title = title.slice(0, 147) + '...';

    return {
      id: postId,
      title: title,
      subreddit: subreddit,
      permalink: permalink,
      timestamp: Date.now()
    };
  }

  /**
   * Determines if the current page is the detailed comments view of a post.
   */
  function isDetailPage() {
    return /\/comments\/[a-zA-Z0-9]+/i.test(window.location.pathname);
  }

  /**
   * Retrieves the post ID corresponding to the current URL if on a detail comments page.
   */
  function getDetailPostIdFromUrl() {
    const match = window.location.pathname.match(/\/comments\/([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Identifies the primary container element for a post (for smooth hiding).
   */
  function getPostContainer(postEl) {
    if (!postEl) return null;
    if (postEl.tagName === 'SHREDDIT-POST') {
      return postEl.closest('article') || postEl;
    }
    if (postEl.classList && postEl.classList.contains('thing')) {
      return postEl;
    }
    return postEl.closest('[data-testid="post-container"]') || postEl;
  }

  // ---------------------------------------------------------------------------
  // Storage Management
  // ---------------------------------------------------------------------------

  /**
   * Initializes data from chrome.storage.local.
   */
  async function initStorage() {
    try {
      const data = await chrome.storage.local.get(['settings', 'hidden_posts']);
      if (data.settings) {
        settings = { ...DEFAULT_SETTINGS, ...data.settings };
      }
      if (data.hidden_posts) {
        hiddenPostsMap = data.hidden_posts;
        hiddenIdSet.clear();
        for (const id of Object.keys(hiddenPostsMap)) {
          hiddenIdSet.add(id.toLowerCase());
        }
      }
    } catch (err) {
      console.warn('[Redone] Error loading storage:', err);
    }
  }

  /**
   * Saves a post as hidden to storage.
   */
  async function persistHiddenPost(postId, meta, reason = 'x_button') {
    if (!postId) return;
    postId = postId.toLowerCase();

    // Already hidden (e.g. opened then re-detected): don't double-count stats.
    // A manual dismiss may still upgrade an 'opened' entry.
    const existing = hiddenPostsMap[postId];
    if (existing && !(reason === 'x_button' && existing.r !== 'x_button')) {
      hiddenIdSet.add(postId);
      return;
    }

    hiddenIdSet.add(postId);

    const postInfo = {
      t: meta.timestamp || Date.now(),
      title: meta.title || '',
      s: meta.subreddit || '',
      permalink: meta.permalink || '',
      r: reason // 'x_button' | 'opened'
    };

    hiddenPostsMap[postId] = postInfo;
    lastHiddenPostInfo = { id: postId, ...postInfo };

    try {
      // Fetch latest state so concurrent tabs don't overwrite each other
      const data = await chrome.storage.local.get(['stats', 'hidden_posts']);
      hiddenPostsMap = { ...(data.hidden_posts || {}), ...hiddenPostsMap };
      const todayDate = localDate();
      const stats = data.stats || {
        totalHidden: 0,
        hiddenByX: 0,
        hiddenByOpen: 0,
        todayHidden: 0,
        todayDate: todayDate
      };

      if (stats.todayDate !== todayDate) {
        stats.todayDate = todayDate;
        stats.todayHidden = 0;
      }

      stats.totalHidden = (stats.totalHidden || 0) + 1;
      stats.todayHidden = (stats.todayHidden || 0) + 1;
      if (reason === 'x_button') {
        stats.hiddenByX = (stats.hiddenByX || 0) + 1;
      } else {
        stats.hiddenByOpen = (stats.hiddenByOpen || 0) + 1;
      }

      // Check max history limit
      const keys = Object.keys(hiddenPostsMap);
      if (keys.length > settings.maxHistory) {
        const sorted = keys.sort((a, b) => (hiddenPostsMap[a].t || 0) - (hiddenPostsMap[b].t || 0));
        const toRemove = sorted.slice(0, keys.length - settings.maxHistory);
        for (const k of toRemove) {
          delete hiddenPostsMap[k];
          hiddenIdSet.delete(k);
        }
      }

      await chrome.storage.local.set({
        hidden_posts: hiddenPostsMap,
        stats: stats
      });
    } catch (err) {
      console.warn('[Redone] Error saving hidden post:', err);
    }
  }

  /**
   * Restores an unhidden post in storage and updates DOM.
   */
  async function persistUnhiddenPost(postId) {
    if (!postId) return;
    postId = postId.toLowerCase();

    hiddenIdSet.delete(postId);
    delete hiddenPostsMap[postId];

    try {
      const data = await chrome.storage.local.get(['hidden_posts']);
      const latest = data.hidden_posts || {};
      delete latest[postId];
      hiddenPostsMap = latest;
      await chrome.storage.local.set({ hidden_posts: latest });
    } catch (err) {
      console.warn('[Redone] Error unhiding post in storage:', err);
    }

    // Restore any matching post element currently in the DOM
    const posts = document.querySelectorAll(`
      shreddit-post[id*="${postId}"],
      shreddit-post[post-id*="${postId}"],
      shreddit-post[permalink*="${postId}"],
      .thing.link[data-fullname*="${postId}"],
      [data-testid="post-container"][id*="${postId}"]
    `);

    posts.forEach((postEl) => {
      const container = getPostContainer(postEl);
      if (container) {
        container.classList.remove('redone-hidden', 'redone-hiding', 'redone-dimmed');
      }
      postEl.dataset.redoneProcessed = 'visible';
    });
  }

  // Listen for storage changes from popup or other tabs
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (changes.settings) {
        settings = { ...settings, ...changes.settings.newValue };
      }

      if (changes.hidden_posts) {
        const newMap = changes.hidden_posts.newValue || {};
        hiddenPostsMap = newMap;
        hiddenIdSet.clear();
        for (const id of Object.keys(newMap)) {
          hiddenIdSet.add(id.toLowerCase());
        }

        // Re-process posts on screen to match updated storage
        scheduleScan();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Post Hiding & UI Feedback
  // ---------------------------------------------------------------------------

  /**
   * Hides a post visually and commits to storage.
   */
  function hidePost(postEl, postId, reason = 'x_button', animate = true) {
    if (!postEl || !postId) return;
    postId = postId.toLowerCase();

    const container = getPostContainer(postEl);
    if (!container) return;

    const meta = extractPostMetadata(postEl, postId);
    persistHiddenPost(postId, meta, reason);

    if (settings.hideStyle === 'dim') {
      container.classList.add('redone-dimmed');
      postEl.classList.add('redone-dimmed');
      postEl.dataset.redoneProcessed = 'dimmed';
    } else {
      if (animate) {
        container.classList.add('redone-hiding');
        postEl.classList.add('redone-hiding');
        setTimeout(() => {
          container.classList.add('redone-hidden');
          postEl.classList.add('redone-hidden');
          container.classList.remove('redone-hiding');
          postEl.classList.remove('redone-hiding');
          postEl.dataset.redoneProcessed = 'hidden';
        }, 220);
      } else {
        container.classList.add('redone-hidden');
        postEl.classList.add('redone-hidden');
        postEl.dataset.redoneProcessed = 'hidden';
      }
    }

    if (settings.showToast && reason === 'x_button') {
      showUndoToast(postId, meta.title);
    }
  }

  /**
   * Displays an interactive Undo Toast notification.
   */
  function showUndoToast(postId, title) {
    let container = document.querySelector('.redone-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'redone-toast-container';
      document.body.appendChild(container);
    }

    // Remove any existing toast
    container.innerHTML = '';
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }

    const toast = document.createElement('div');
    toast.className = 'redone-toast';

    const cleanTitle = (title || 'Post').length > 32 ? (title || 'Post').slice(0, 30) + '...' : (title || 'Post');

    toast.innerHTML = `
      <svg class="redone-toast-icon" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
      </svg>
      <span class="redone-toast-text">Hidden: <strong>${escapeHtml(cleanTitle)}</strong></span>
      <button type="button" class="redone-toast-undo">Undo</button>
      <button type="button" class="redone-toast-close" title="Dismiss" aria-label="Dismiss">✕</button>
    `;

    const undoBtn = toast.querySelector('.redone-toast-undo');
    const closeBtn = toast.querySelector('.redone-toast-close');

    function closeToast() {
      toast.classList.add('redone-toast-closing');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }

    undoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      persistUnhiddenPost(postId);
      toast.querySelector('.redone-toast-text').textContent = 'Post restored!';
      undoBtn.style.display = 'none';
      setTimeout(closeToast, 1200);
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeToast();
    });

    container.appendChild(toast);
    toastTimeout = setTimeout(closeToast, 4000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Dismiss Button Injection
  // ---------------------------------------------------------------------------

  /**
   * Injects the "X" dismiss button into a post element.
   */
  function injectDismissButton(postEl, postId) {
    if (!settings.hideOnX) return;
    if (postEl.querySelector('.redone-hide-btn') || postEl.dataset.redoneHasBtn === 'true') {
      return;
    }

    postEl.dataset.redoneHasBtn = 'true';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'redone-hide-btn';
    btn.title = "Hide post (won't be shown again)";
    btn.setAttribute('aria-label', 'Hide post');
    btn.setAttribute('data-post-id', postId);

    btn.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor">
        <line x1="15" y1="5" x2="5" y2="15"></line>
        <line x1="5" y1="5" x2="15" y2="15"></line>
      </svg>
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      hidePost(postEl, postId, 'x_button', true);
    });

    // Placement strategy across layouts
    if (postEl.tagName === 'SHREDDIT-POST') {
      const overflowMenu = postEl.querySelector('shreddit-post-overflow-menu, [slot="post-overflow-menu"]');
      const creditBar = postEl.querySelector('[slot="credit-bar"]');

      if (overflowMenu && overflowMenu.parentNode) {
        btn.classList.add('redone-hide-btn-inline');
        overflowMenu.parentNode.insertBefore(btn, overflowMenu);
      } else if (creditBar) {
        btn.classList.add('redone-hide-btn-inline');
        creditBar.appendChild(btn);
      } else {
        postEl.appendChild(btn);
      }
    } else if (postEl.classList && postEl.classList.contains('thing')) {
      // Old Reddit
      const entry = postEl.querySelector('.entry') || postEl;
      entry.appendChild(btn);
    } else {
      // New Reddit
      postEl.appendChild(btn);
    }
  }

  // ---------------------------------------------------------------------------
  // Post Scanning & Processing
  // ---------------------------------------------------------------------------

  /**
   * Processes a single post element: hides if in hidden list, else injects dismiss button.
   */
  function processPostElement(postEl) {
    if (!postEl || postEl.nodeType !== Node.ELEMENT_NODE) return;

    const postId = extractPostId(postEl);
    if (!postId) return;

    // Do NOT hide the post actively being viewed on its detail page
    const isCurrentActivePost = (postId === currentDetailPostId && isDetailPage());

    const container = getPostContainer(postEl);

    if (hiddenIdSet.has(postId) && !isCurrentActivePost) {
      if (settings.hideStyle === 'dim') {
        container.classList.add('redone-dimmed');
        postEl.classList.add('redone-dimmed');
      } else {
        container.classList.add('redone-hidden');
        postEl.classList.add('redone-hidden');
      }
      postEl.dataset.redoneProcessed = 'hidden';
    } else {
      // Make sure it's visible
      if (container.classList.contains('redone-hidden')) {
        container.classList.remove('redone-hidden');
      }
      if (postEl.classList.contains('redone-hidden')) {
        postEl.classList.remove('redone-hidden');
      }
      if (container.classList.contains('redone-dimmed')) {
        container.classList.remove('redone-dimmed');
      }
      if (postEl.classList.contains('redone-dimmed')) {
        postEl.classList.remove('redone-dimmed');
      }
      postEl.dataset.redoneProcessed = 'visible';

      // Inject dismiss button
      injectDismissButton(postEl, postId);
    }
  }

  /**
   * Scans a root element (or entire document) for posts.
   */
  function scanPosts(root = document) {
    if (!root) return;

    // Check root itself
    if (root.matches && root.matches('shreddit-post, .thing.link, [data-testid="post-container"]')) {
      processPostElement(root);
    }

    // Check all matching children
    const postElements = root.querySelectorAll('shreddit-post, .thing.link, [data-testid="post-container"]');
    postElements.forEach(processPostElement);
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scanPosts(document);
    });
  }

  // ---------------------------------------------------------------------------
  // Navigation & URL Change Observer (SPA Support)
  // ---------------------------------------------------------------------------

  function handleUrlChange() {
    const newUrl = window.location.href;
    if (newUrl === lastUrl) return;
    lastUrl = newUrl;

    if (isDetailPage()) {
      const postId = getDetailPostIdFromUrl();
      currentDetailPostId = postId;

      // "Also if I open that post, the post will not be shown again"
      if (postId && settings.hideOnOpen) {
        const meta = extractPostMetadata(document.querySelector('shreddit-post, [data-testid="post-container"], .thing.link'), postId);
        persistHiddenPost(postId, meta, 'opened');
      }
    } else {
      currentDetailPostId = null;
    }

    // Re-scan feed posts immediately
    scheduleScan();
  }

  window.addEventListener('popstate', handleUrlChange);
  window.addEventListener('hashchange', handleUrlChange);
  window.addEventListener('pageshow', () => {
    handleUrlChange();
    scheduleScan();
  });

  // Periodic URL check fallback for custom client-side routers
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      handleUrlChange();
    }
  }, 300);

  // ---------------------------------------------------------------------------
  // Post Click & Open Detector
  // ---------------------------------------------------------------------------

  function handlePostInteraction(event) {
    if (!settings.hideOnOpen) return;

    // Only respond to main left click (0) or middle click (1)
    if (event.button !== 0 && event.button !== 1) return;

    const path = event.composedPath ? event.composedPath() : [];

    // Ignore clicks on our dismiss button or toast
    if (path.some(el => el.classList && (el.classList.contains('redone-hide-btn') || el.classList.contains('redone-toast')))) {
      return;
    }

    // Ignore clicks on interactive controls that do NOT open the post
    const isControlClick = path.some(el => {
      if (!el || !el.getAttribute) return false;
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const tagName = (el.tagName || '').toLowerCase();
      const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();

      // Voting buttons
      if (ariaLabel.includes('upvote') || ariaLabel.includes('downvote')) return true;
      if (className.includes('arrow') || className.includes('vote')) return true;

      // Subreddit chip or Author profile
      if (tagName === 'a') {
        const href = el.getAttribute('href') || '';
        // If clicking /r/subreddit without /comments/
        if (href.startsWith('/r/') && !href.includes('/comments/')) return true;
        // User profile
        if (href.startsWith('/u/') || href.startsWith('/user/')) return true;
      }

      // Share, save, overflow menu buttons
      if (tagName === 'shreddit-post-overflow-menu' || el.getAttribute('slot') === 'post-overflow-menu') return true;
      if (ariaLabel.includes('more actions') || ariaLabel.includes('share') || ariaLabel.includes('save')) return true;

      return false;
    });

    if (isControlClick) return;

    // Find the post element or comments link
    let postEl = null;
    let clickedCommentsLink = false;

    for (const el of path) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;

      if (el.tagName === 'A' && el.href && /comments\/[a-zA-Z0-9]+/i.test(el.href)) {
        clickedCommentsLink = true;
      }

      if (el.tagName === 'SHREDDIT-POST' ||
        (el.classList && el.classList.contains('thing')) ||
        (el.matches && el.matches('[data-testid="post-container"]'))) {
        postEl = el;
        break;
      }
    }

    if (!postEl && !clickedCommentsLink) return;

    const postId = extractPostId(postEl) || (clickedCommentsLink ? extractPostId(event.target.closest('a[href*="/comments/"]')?.href) : null);
    if (!postId) return;

    const meta = extractPostMetadata(postEl, postId);
    persistHiddenPost(postId, meta, 'opened');

    // If opened in new tab (middle-click or Ctrl/Cmd + click)
    const isNewTab = (event.button === 1) || (event.button === 0 && (event.ctrlKey || event.metaKey));
    if (isNewTab && settings.hideOnNewTab && postEl) {
      // Smoothly hide from current feed view
      hidePost(postEl, postId, 'opened', true);
    }
  }

  document.addEventListener('click', handlePostInteraction, true);
  document.addEventListener('auxclick', handlePostInteraction, true);

  // ---------------------------------------------------------------------------
  // MutationObserver for Infinite Scrolling & Dynamic Feeds
  // ---------------------------------------------------------------------------

  const domObserver = new MutationObserver((mutations) => {
    let shouldScan = false;

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target && target.matches && target.matches('shreddit-post, .thing.link, [data-testid="post-container"]')) {
          shouldScan = true;
          break;
        }
      } else if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches('shreddit-post, .thing.link, [data-testid="post-container"]')) {
              shouldScan = true;
              break;
            }
            if (node.querySelector && node.querySelector('shreddit-post, .thing.link, [data-testid="post-container"]')) {
              shouldScan = true;
              break;
            }
          }
        }
      }
      if (shouldScan) break;
    }

    if (shouldScan) {
      scheduleScan();
    }
  });

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async function init() {
    await initStorage();

    if (isDetailPage()) {
      currentDetailPostId = getDetailPostIdFromUrl();
      if (currentDetailPostId && settings.hideOnOpen) {
        persistHiddenPost(currentDetailPostId, { timestamp: Date.now() }, 'opened');
      }
    }

    // Start observing DOM mutations (both added elements and post attribute hydration)
    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id', 'post-id', 'permalink', 'data-fullname']
    });

    // Run initial scan
    scheduleScan();

    // Re-scan when DOM is fully interactive
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleScan);
    }
  }

  init();

})();
