var AIAdapters = globalThis.AIAdapters || (globalThis.AIAdapters = {});

var GOOGLE_AUTH_COOKIES = {
  SID: 1,
  HSID: 1,
  SSID: 1,
  APISID: 1,
  SAPISID: 1,
  "__Secure-1PSID": 1,
  "__Secure-3PSID": 1,
  "__Secure-1PAPISID": 1,
};

function geminiSignedInFromCookies(cookies) {
  if (!cookies) return false;
  for (var i = 0; i < cookies.length; i++) {
    if (GOOGLE_AUTH_COOKIES[cookies[i].name]) return true;
  }
  return false;
}

function interpretGemini(raw, signedInHint) {
  if (!raw) {
    if (signedInHint) return { kind: "reading", signedIn: true, percent: null, resetsAt: null, periodMs: null, products: [], note: "Signed in, usage not exposed" };
    return { kind: "transient", note: "Could not reach Gemini" };
  }
  if (raw.error) return { kind: "transient", note: "Could not reach Gemini" };
  var finalUrl = raw.finalUrl || "";
  var blob = [raw.text || "", raw.domText || "", raw.iframeText || ""].join("\n");
  if (/accounts\.google\.com/i.test(finalUrl)) return { kind: "signed-out" };
  var parsed = parseGeminiSource(blob, Date.now());
  if (parsed.signedOut) return { kind: "signed-out" };
  if (parsed.percent == null) {
    if (signedInHint) {
      return { kind: "reading", signedIn: true, percent: null, resetsAt: null, periodMs: null, products: [], note: "Signed in, usage not exposed" };
    }
    if (raw.status === 401 || raw.status === 403) return { kind: "signed-out" };
    if (raw.status === 200 && signedInHint === false) return { kind: "signed-out" };
    if (raw.status == null && !signedInHint) return { kind: "transient", note: "Could not reach Gemini" };
    return { kind: "signed-out" };
  }
  return {
    kind: "reading",
    signedIn: true,
    percent: parsed.percent,
    resetsAt: parsed.resetsAt,
    periodMs: parsed.periodMs,
    products: parsed.products,
    note: "",
  };
}

function pickToken(html, key) {
  var re = new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"');
  var match = String(html || "").match(re);
  if (!match) return "";
  return match[1].replace(/\\u003d/gi, "=").replace(/\\u0026/gi, "&").replace(/\\"/g, '"');
}

async function geminiHeaders() {
  var headers = {
    Origin: "https://gemini.google.com",
    Referer: "https://gemini.google.com/usage",
  };
  try {
    var jar = await browser.cookies.getAll({ url: "https://gemini.google.com/" });
    if (jar && jar.length) {
      headers.Cookie = jar
        .map(function (cookie) {
          return cookie.name + "=" + cookie.value;
        })
        .join("; ");
    }
  } catch (err) {
    /* cookie jar can fail in a page context */
  }
  return headers;
}

async function geminiPage(headers, url) {
  var init = { method: "GET", headers: headers, credentials: "include", cache: "no-store", redirect: "follow" };
  var res = await fetch(url, init);
  var html = "";
  try {
    html = await res.text();
  } catch (err) {
    html = "";
  }
  return { status: res.status, finalUrl: res.url || url, html: html };
}

async function geminiQuotaCall(prefix, tokens, args, headers) {
  var query = new URLSearchParams({
    rpcids: "qpEbW",
    "source-path": "/app",
    bl: tokens.buildLabel || "",
    "f.sid": tokens.sessionId || "",
    hl: tokens.locale || "en",
    _reqid: String(Math.floor(100000 + Math.random() * 900000)),
    rt: "c",
  });
  var body = new URLSearchParams({
    "f.req": JSON.stringify([[["qpEbW", args, null, "generic"]]]),
    at: tokens.requestToken,
  });
  var postHeaders = {};
  for (var key in headers) postHeaders[key] = headers[key];
  postHeaders["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  postHeaders["x-same-domain"] = "1";
  var postInit = { method: "POST", headers: postHeaders, body: body.toString(), credentials: "include", cache: "no-store" };
  var rpc = await fetch("https://gemini.google.com" + prefix + "/_/BardChatUi/data/batchexecute?" + query.toString(), postInit);
  var text = "";
  try {
    text = await rpc.text();
  } catch (err) {
    text = "";
  }
  return { status: rpc.status, text: text };
}

async function pullGeminiDirect() {
  var headers = await geminiHeaders();
  var page = await geminiPage(headers, "https://gemini.google.com/app");
  var finalUrl = page.finalUrl || "";
  var account = finalUrl.match(/gemini\.google\.com(\/u\/\d+)/);
  var prefix = account ? account[1] : "";
  var tokens = {
    buildLabel: pickToken(page.html, "cfb2h"),
    sessionId: pickToken(page.html, "FdrFJe"),
    requestToken: pickToken(page.html, "SNlM0e"),
    locale: pickToken(page.html, "GGcqce") || "en",
  };
  if (!tokens.requestToken && prefix) {
    var again = await geminiPage(headers, "https://gemini.google.com" + prefix + "/app");
    page = again;
    finalUrl = again.finalUrl || finalUrl;
    tokens.buildLabel = pickToken(again.html, "cfb2h");
    tokens.sessionId = pickToken(again.html, "FdrFJe");
    tokens.requestToken = pickToken(again.html, "SNlM0e");
    tokens.locale = pickToken(again.html, "GGcqce") || tokens.locale;
  }
  if (!tokens.requestToken) {
    return { status: page.status, finalUrl: finalUrl, text: page.html || "" };
  }
  var compute = await geminiQuotaCall(prefix, tokens, JSON.stringify([[[1, 2]]]), headers);
  var rest = { status: 0, text: "" };
  try {
    rest = await geminiQuotaCall(prefix, tokens, "[]", headers);
  } catch (err) {
    rest = { status: 0, text: "" };
  }
  var text = [compute.text, rest.text].filter(Boolean).join("\n");
  return { status: compute.status || rest.status || page.status, finalUrl: finalUrl, text: text || page.html || "" };
}

function installGeminiOriginRule() {
  try {
    if (!browser.declarativeNetRequest || !browser.declarativeNetRequest.updateSessionRules) return;
    var tabNone = browser.tabs && browser.tabs.TAB_ID_NONE != null ? browser.tabs.TAB_ID_NONE : -1;
    browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "origin", operation: "set", value: "https://gemini.google.com" },
              { header: "referer", operation: "set", value: "https://gemini.google.com/app" },
            ],
          },
          condition: {
            urlFilter: "|https://gemini.google.com/",
            tabIds: [tabNone],
            resourceTypes: ["xmlhttprequest"],
          },
        },
      ],
    }).catch(function () {});
  } catch (err) {
    /* optional; the cookie jar still sends the session */
  }
}

AIAdapters.gemini = {
  id: "gemini",
  label: "Gemini",
  match: "https://gemini.google.com/*",
  async pull() {
    try {
      var cookies = [];
      try {
        cookies = await browser.cookies.getAll({ url: "https://gemini.google.com/" });
      } catch (err) {
        cookies = [];
      }
      var signedInHint = geminiSignedInFromCookies(cookies);
      var fromTab = null;
      try {
        fromTab = await askTab(this.match, this.id);
      } catch (err) {
        fromTab = null;
      }
      if (fromTab && !fromTab.error) {
        var fromPage = interpretGemini(fromTab, signedInHint);
        if (fromPage.percent != null || fromPage.kind === "signed-out") return fromPage;
      }
      var direct = await pullGeminiDirect();
      return interpretGemini(direct, signedInHint);
    } catch (err) {
      return { kind: "transient", note: "Could not reach Gemini" };
    }
  },
  ingest(message) {
    if (!message.body) return null;
    var parsed = parseGeminiSource(message.body, Date.now());
    if (parsed.signedOut) return { kind: "signed-out" };
    if (parsed.percent == null) return null;
    return {
      kind: "reading",
      signedIn: true,
      percent: parsed.percent,
      resetsAt: parsed.resetsAt,
      periodMs: parsed.periodMs,
      products: parsed.products,
      note: "",
    };
  },
};
