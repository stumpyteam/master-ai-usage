# Master AI Usage

One Firefox extension. One toolbar icon. One popup.

The tile follows the site in the active tab: grok.com, gemini.google.com, chatgpt.com, or claude.ai. Anywhere else it shows the highest live usage among signed-in services. Grok, Gemini, ChatGPT, and Claude ship. Each one is an adapter that returns `{ percent, resetsAt, products, note }`. If a site does not expose a number, the popup says "Signed in, usage not exposed". It never invents a percent.

Usage percents stay free. Token balances are a one-time $4.99 unlock, the same Stripe payment and the same unlock code as Grok Usage. A code from either extension works in both.

## Packages

- Firefox: `master-ai-usage-1.0.31-firefox.xpi`

Windows, macOS, and Linux use the same package.

Firefox: Add-ons and themes → gear → Install Add-on From File → choose the xpi.

## Reviewer notes

There is no build step. The xpi is the source. No minifier, no webpack, no bundler, no template engine.

Bump `manifest.json` version on every upload.

Category: Other.

Listing tags: grok, gemini, chatgpt, claude, usage tracker, rate limit, toolbar, weekly allowance.

The store icon is the meter mark. The toolbar icon is the original block-digit tile: a filled usage color with hard 7-row digits, capped at 99, no percent sign.

Data stays in the browser. The extension reads the signed-in session on each site and does not send it anywhere else. `data_collection_permissions.required` is `["authenticationInfo"]`, because the extension reads each site's signed-in session to fetch usage. Nothing is sent to us.

## Adapters

Grok: cookie session on grok.com, `POST /rest/grok/credits`, plus a MAIN-world hook for `GetGrokCreditsConfig`. A past weekly end clears the percent until a future end arrives. The reset label rolls forward by seven days and never stays on a past date. A 401 or 403 is signed out. A transient failure keeps the last percent.

Gemini: signed-in Google cookies, then `CheckGeminiQuota` (`qpEbW`), the same call the Usage limits page uses. The popup shows the current window and the weekly percent when that reply includes them. If it does not, the row stays "Signed in, usage not exposed".

ChatGPT: `/api/auth/session`, then `GET /backend-api/wham/usage`. The percent is the higher `used_percent` window that response includes. Missing windows stay blank.

Claude: `GET /api/organizations` on claude.ai to find the organization, then `GET /api/organizations/{id}/usage`. Reads the 5-hour and weekly windows, plus any model-specific buckets in `limits`. The headline percent is the highest window. On a Free plan the row says "Free plan: Claude does not expose usage numbers". A 401 or 403 is signed out.
