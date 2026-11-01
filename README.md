<p align="center">
  <img src="docs/icon-128.png" width="96" alt="Master AI Usage">
</p>

<h1 align="center">Master AI Usage</h1>

<p align="center">
  One toolbar percentage for Grok, Gemini, ChatGPT, and Claude.<br>
  Reads each site's own usage and never invents a number.
</p>

<p align="center">
  <a href="https://addons.mozilla.org/en-US/firefox/addon/master-ai-usage/"><strong>Get it for Firefox</strong></a>
</p>

<p align="center">
  <img src="docs/icon-128.png" width="48" alt="Store icon">
  <img src="docs/toolbar-icon.png" width="48" alt="Toolbar icon">
</p>

---

## What's new in 1.0.31

- **Claude support.** Reads your usage on claude.ai: the 5-hour and weekly windows, plus any model-specific buckets.
- Claude is in the toolbar tile, the popup, and the unlock, the same as Gemini and ChatGPT.
- On a Free Claude plan the row says "Free plan: Claude does not expose usage numbers".

<p align="center">
  <img src="docs/screenshots/06-claude.png" width="480" alt="Claude in the popup with the unlock (sample data)">
  <br>
  Claude next to Grok, Gemini, and ChatGPT, with the unlock on (sample data).
</p>

---

## Screenshots

### The toolbar follows the site

On grok.com, Gemini, ChatGPT, or claude.ai it shows that service. Anywhere else, the highest live percentage.

<p align="center">
  <img src="docs/screenshots/01-toolbar.png" width="640" alt="Toolbar follows the site">
</p>

### Usage percentages stay free

Headline percentage, reset time, and the Grok breakdown. No account required.

<p align="center">
  <img src="docs/screenshots/02-free-popup.png" width="480" alt="Free popup">
</p>

### One unlock covers every tracker

Gemini, ChatGPT, and Claude window rows, the plan name, and token balances.

<p align="center">
  <img src="docs/screenshots/03-unlocked.png" width="480" alt="Unlocked view">
</p>

### One-time unlock

Buy with Apple Pay, Google Pay, or card, or paste a code. A Grok Usage code works here. $4.99, once.

<p align="center">
  <img src="docs/screenshots/04-unlock.png" width="480" alt="Unlock">
</p>

### Token balances stay on this device

Optional. Paste a Team ID and management key. They stay on this device and are not sent anywhere.

<p align="center">
  <img src="docs/screenshots/05-tokens.png" width="480" alt="Tokens">
</p>

---

## What it does

The tile follows the site in the active tab: grok.com, gemini.google.com, chatgpt.com, or claude.ai. Anywhere else it shows the highest live usage among signed-in services.

Each service is an adapter in `adapters/` that returns `{ percent, resetsAt, products, note }`. If a site does not expose a number, the popup says "Signed in, usage not exposed". It never invents a percent.

Usage percentages stay free. Token balances and the extra window rows are a one-time $4.99 unlock, the same Stripe payment and the same unlock code as Grok Usage. A code from either extension works in both.

## Install

- Firefox: install from [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/master-ai-usage/)
- Firefox: `master-ai-usage-1.0.31-firefox.xpi`

Windows, macOS, and Linux use the same package.

Firefox: Add-ons and themes → gear → Install Add-on From File → choose the xpi.

## Layout

- `manifest.json` is the Firefox manifest.
- `background.js` refreshes each service. `adapters/` has one file per service.
- `parse.js` reads each site's reply. `period.js` handles resets and the toolbar choice. `icon.js` draws the tile.
- `popup.html`, `popup.js`, and `popup.css` are the popup. `pay.js` checks unlock codes on the device.
- There is no build step. The files here are what ships.

## Privacy

Data stays in the browser. The extension reads the signed-in session on each site and does not send it anywhere else.
