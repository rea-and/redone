# Redone — Reddit Desktop Post Filter & Auto-Hide

**Redone** is a lightweight, high-performance Chrome extension (Manifest V3) that streamlines and declutters your Reddit desktop browsing experience.

## ✨ Features

- **Quick "✕" Dismiss Button on Every Post**: Adds a clean, native-styled "✕" button to every post row and card across Reddit.
- **Never See Dismissed Posts Again**: Clicking "✕" smoothly collapses the post and permanently hides it from your feeds.
- **Auto-Hide Opened Posts**: Any post you open (click title, thumbnail, or comments) is automatically remembered and hidden so it never appears in your feed again.
- **Instant Hide on New Tab**: Middle-clicking or Ctrl/Cmd-clicking a post to open it in a new tab smoothly removes it from your current feed immediately.
- **Detail View Safe**: You can comfortably read a post on its comment page without it being hidden while you are reading it. As soon as you navigate back or return to any feed, it disappears from view.
- **1-Click Undo Toast**: Accidentally dismissed a post? A sleek, floating undo toast lets you restore it with one click.
- **Comprehensive Popup Dashboard**:
  - Live statistics: Total posts hidden, hidden today, hidden via "✕", and hidden via reading.
  - Custom settings: Toggle the "✕" button, toggle auto-hide on open, customize animation style (smooth collapse vs. dim).
  - Searchable History: Browse your recently hidden posts with subreddit badges, titles, and timestamps, and easily unhide/restore any post.
  - Backup & Restore: Export and import your hidden post list as JSON.
- **Works Across All Reddit Layouts**:
  - **Modern Reddit** (`reddit.com` / `shreddit` web components) in Card, Classic, and Compact views.
  - **Old Reddit** (`old.reddit.com`).
  - **New Reddit** (`new.reddit.com` / 2018 redesign).
- **100% Private & Local**: All data is stored locally in your browser (`chrome.storage.local`). Zero telemetry, zero analytics, zero external network requests.

---

## 🚀 Installation Instructions (Chrome / Chromium Browsers)

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in your address bar.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the extension directory:
   ```
   /Users/andrea/Projects/redone
   ```
6. The **Redone** icon will appear in your extensions toolbar. Pin it for quick access!

---

## 🛠️ How It Works

1. **Feed Browsing**:
   - As you scroll through Reddit, an "✕" button appears at the top right of each post (or inline with the post actions).
   - Click the "✕" button to dismiss any post. It fades and collapses away, and you'll see a brief "Undo" notification in case you clicked by mistake.
2. **Opening Posts**:
   - Whenever you click a post's title, thumbnail, or comments link, Redone records the canonical post ID.
   - When you press Back or return to your feed, that post is automatically hidden.
   - If you open a post in a new tab (middle-click or Ctrl+click), Redone hides it from your current feed right away so you can keep reading fresh content.
3. **Restoring Posts**:
   - Click the Redone icon in the Chrome toolbar.
   - Switch to the **Recent Posts** tab.
   - Use the search bar or list to find the post and click **Restore**.

---

## 📁 File Structure

```
redone/
├── manifest.json       # Manifest V3 extension configuration
├── content.js          # Injected script: handles DOM observation, button injection & clicks
├── content.css         # Clean styling for the 'X' button, animations, and undo toast
├── background.js       # Service worker: initializes storage and manages badge counter
├── popup.html          # Extension toolbar dashboard interface
├── popup.js            # Controller for popup settings, live stats, and history management
├── popup.css           # Modern dark-mode styling for the popup
├── icons/              # Extension icons (16px, 32px, 48px, 128px)
└── README.md           # Documentation and setup instructions
```
