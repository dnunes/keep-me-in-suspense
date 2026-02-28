# Keep Me in Suspense

Built with a performance-first approach, every design decision prioritizes minimal resource usage so the extension itself never becomes the thing slowing your machine down.

A Chrome extension that automatically suspends inactive tabs to free up memory and CPU, with configurable rules, whitelist support, and smart activity detection.

---

## Features

- **Automatic suspension:** tabs are suspended after a configurable period of inactivity
- **Two suspension modes:** replace the tab with a lightweight page, or use Chrome's native discard API
- **Activity-aware:** resets the inactivity timer on clicks, keypresses, and scrolls; ignores mouse movement
- **Rule-based control:** define which tabs to suspend using URL patterns or Chrome tab group names, each with their own delay
- **Whitelist support:** exempt specific tabs from ever being suspended
- **Media protection:** built-in rules for popular streaming platforms (YouTube, Netflix, Spotify, Twitch, and more) that only protect tabs actively playing media
- **Visual indicators:** suspended tabs are prefixed with 💤 and retain their original favicon
- **Opt-in model:** no tabs are suspended until you configure at least one activation rule


## Installation

Install directly from the [Chrome Web Store](#) *(link coming soon)*.

**Manual install (developer mode):**

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repository folder


## Usage

Click the toolbar icon to open a quick-action popup, or open the side panel for full configuration:

- **Activation rules:** define which tabs are eligible for suspension and after how long
- **Whitelist rules:** define tabs that should never be suspended
- **Global settings:** enable/disable the extension, choose suspension mode, and protect pinned tabs

Right-clicking the toolbar icon also exposes quick actions: suspend the current tab, or unsuspend all tabs at once.


## License

[GNU General Public License v3.0](LICENSE)