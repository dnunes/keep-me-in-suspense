# Keep Me in Suspense

Built with a performance-first approach, every design decision prioritizes minimal resource usage so the extension itself never becomes the thing slowing your machine down.

A tab suspension extension with **full Chrome support** and **Vivaldi-exclusive extras**, automatically suspending inactive tabs to free up memory and CPU, with configurable rules, whitelist support, and smart activity detection.

---

## ⚠️ Current Status: Unusable

The extension is currently non-functional and under active redesign. Do not attempt to install or use it yet.

**Known issues to fix before it is usable:**
- [ ] Core suspension logic needs review and testing
- [ ] UI is incomplete
- [ ] No real-world testing has been done

---

## Browser Support

- **Chrome** — 100% supported. All features work as expected.
- **Vivaldi** — 100% supported, plus additional Vivaldi-exclusive features not available in other browsers:
  - **Workspaces** — use Vivaldi Workspaces as a grouping dimension for suspension rules, in addition to Chrome Tab Groups
    - Needs investigation: Vivaldi Workspaces are not exposed via the standard Chrome extension API — research whether Vivaldi provides any internal/private API for this
  - **Tab Stacks** — Vivaldi's equivalent of Chrome Tab Groups; needs investigation on whether the standard `tabGroups` API maps to Tab Stacks or if they are separate concepts entirely
- **Other Chromium browsers** — should work as a baseline (untested)

The goal is to support Vivaldi concepts that extensions typically ignore, while keeping full compatibility with Chrome. Vivaldi-exclusive features degrade gracefully when running on Chrome.

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