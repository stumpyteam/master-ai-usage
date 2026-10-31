var browser = globalThis.browser || globalThis.chrome;

if (typeof parseCredits !== "function" && typeof importScripts === "function") {
  importScripts(
    "parse.js",
    "period.js",
    "icon.js",
    "net.js",
    "adapters/grok.js",
    "adapters/gemini.js",
    "adapters/chatgpt.js",
    "adapters/claude.js",
    "pay.js",
  );
}

var refreshing = null;

function base64ToBytes(b64) {
  var bin = atob(b64);
  var out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
  return out;
}

function loadSnapshot() {
  return browser.storage.local.get("snapshot").then(function (stored) {
    var snapshot = stored && stored.snapshot ? stored.snapshot : defaultSnapshot();
    if (!snapshot.services) snapshot = defaultSnapshot();
    var fresh = defaultSnapshot();
    fresh.theme = snapshot.theme || "auto";
    for (var i = 0; i < SERVICE_ORDER.length; i++) {
      var id = SERVICE_ORDER[i];
      fresh.services[id] = Object.assign(blankService(id, fresh.services[id].label), snapshot.services[id] || {});
      fresh.services[id].id = id;
      fresh.services[id].label = fresh.services[id].label || defaultSnapshot().services[id].label;
    }
    return fresh;
  });
}

function saveSnapshot(snapshot) {
  return browser.storage.local.set({ snapshot: snapshot });
}

var focusedSite = null;

function paintSnapshot(snapshot) {
  var percent = toolbarPercent(snapshot, Date.now(), focusedSite);
  var name = focusedSite && snapshot.services[focusedSite] ? snapshot.services[focusedSite].label : "";
  var title = "AI usage 1.0.31";
  if (name && percent == null) title = name + " · " + title;
  else if (name) title = name + " " + digitsFor(percent) + "% · " + title;
  else if (percent != null) title = title + " · " + digitsFor(percent);
  var writes = [];
  try {
    writes.push(browser.action.setIcon({ imageData: tilesFor(percent) }));
  } catch (err) {
    writes.push(Promise.resolve());
  }
  writes.push(browser.action.setTitle({ title: title }));
  try {
    writes.push(browser.action.setBadgeText({ text: "" }));
  } catch (err) {
    writes.push(Promise.resolve());
  }
  return Promise.all(writes).catch(function () {});
}

function commitService(snapshot, id, reading) {
  snapshot.services[id] = applyReading(snapshot.services[id], reading, Date.now());
}

async function refreshAll() {
  if (refreshing) return refreshing;
  refreshing = (async function () {
    var snapshot = await loadSnapshot();
    reapSnapshot(snapshot, Date.now());
    var ids = SERVICE_ORDER.slice();
    var readings = await Promise.all(
      ids.map(function (id) {
        return withTimeout(AIAdapters[id].pull(), 15000, "Could not reach " + AIAdapters[id].label);
      }),
    );
    for (var i = 0; i < ids.length; i++) commitService(snapshot, ids[i], readings[i]);
    reapSnapshot(snapshot, Date.now());
    await saveSnapshot(snapshot);
    await paintSnapshot(snapshot);
    await pullGrokTokens();
    return snapshot;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

async function refreshOne(id) {
  var snapshot = await loadSnapshot();
  var reading = await withTimeout(AIAdapters[id].pull(), 15000, "Could not reach " + AIAdapters[id].label);
  commitService(snapshot, id, reading);
  reapSnapshot(snapshot, Date.now());
  await saveSnapshot(snapshot);
  await paintSnapshot(snapshot);
  return snapshot;
}

var TEAM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function licenseOk() {
  return browser.storage.local.get("license").then(function (stored) {
    var key = stored && stored.license && stored.license.key;
    if (!key || typeof verifyUnlock !== "function") return false;
    return verifyUnlock(key).then(Boolean);
  });
}

function readManual() {
  return browser.storage.local.get("manual").then(function (stored) {
    return stored && stored.manual && typeof stored.manual === "object" ? stored.manual : null;
  });
}

function saveTokens(partial) {
  return browser.storage.local.get("tokens").then(function (stored) {
    var prev = stored && stored.tokens && typeof stored.tokens === "object" ? stored.tokens : {};
    var next = {};
    var name;
    for (name in prev) next[name] = prev[name];
    for (name in partial) next[name] = partial[name];
    return browser.storage.local.set({ tokens: next });
  });
}

async function pullGrokTokens() {
  if (!(await licenseOk())) return;
  var manual = await readManual();
  if (!manual || !manual.teamId || !manual.key) {
    await saveTokens({ grokPercent: null, grokLabel: "Paste a team id and management key.", grokError: "" });
    return;
  }
  var response;
  try {
    response = await fetch(
      "https://management-api.x.ai/v1/billing/teams/" + encodeURIComponent(manual.teamId) + "/prepaid/balance",
      { headers: { Authorization: "Bearer " + manual.key, Accept: "application/json" } },
    );
  } catch (err) {
    await saveTokens({ grokError: "Could not reach xAI." });
    return;
  }
  if (response.status === 401 || response.status === 403) {
    await saveTokens({ grokPercent: null, grokLabel: "That management key was rejected.", grokError: "That management key was rejected." });
    return;
  }
  if (response.status === 404) {
    await saveTokens({ grokPercent: null, grokLabel: "No team with that id.", grokError: "No team with that id." });
    return;
  }
  if (!response.ok) {
    await saveTokens({ grokError: "xAI returned " + response.status + "." });
    return;
  }
  var body;
  try {
    body = await response.json();
  } catch (err) {
    await saveTokens({ grokError: "xAI did not return JSON." });
    return;
  }
  var view = prepaidView(body);
  await saveTokens({
    grokPercent: view.percent,
    grokLabel: view.account,
    grokCents: view.prepaidCents,
    grokError: "",
  });
}

function saveManual(message) {
  return licenseOk().then(function (ok) {
    if (!ok) return { ok: false, error: "Unlock all trackers first." };
    var directKey = typeof message.key === "string" ? message.key.trim() : "";
    var directTeam = typeof message.teamId === "string" ? message.teamId.trim() : "";
    var teamId = "";
    var key = "";
    if (directKey || directTeam) {
      if (!TEAM_ID.test(directTeam)) return { ok: false, error: "Paste the Team ID from General, under Team." };
      if (directKey.length < 8) return { ok: false, error: "Paste the management key." };
      teamId = directTeam;
      key = directKey;
    } else {
      var parsed = parseShell(message.curl);
      if (parsed.error) return { ok: false, error: parsed.error };
      if (!parsed.teamId) return { ok: false, error: "That curl has no team id." };
      teamId = parsed.teamId;
      key = parsed.key;
    }
    return browser.storage.local
      .set({ manual: { mode: "api", teamId: teamId, key: key, curl: typeof message.curl === "string" ? message.curl : "" } })
      .then(function () {
        return pullGrokTokens().then(function () {
          return { ok: true };
        });
      });
  });
}

function schedule() {
  browser.alarms.create("poll", { periodInMinutes: 1 });
}

function classifyObserved(url) {
  var value = String(url || "");
  if (/\/rest\/grok\/credits|GetGrokCreditsConfig|getGrokCreditsConfig/i.test(value)) return "grok";
  if (/chatgpt\.com/i.test(value) && /\/backend-api\/wham\/usage/i.test(value)) return "chatgpt";
  if (/gemini\.google\.com/i.test(value) && (/usage/i.test(value) || /batchexecute/i.test(value) || /qpEbW/.test(value))) return "gemini";
  if (/claude\.ai/i.test(value) && /\/api\/organizations\/[^/]+\/usage/i.test(value)) return "claude";
  return null;
}

browser.runtime.onInstalled.addListener(function () {
  schedule();
  refreshAll();
});

browser.runtime.onStartup.addListener(function () {
  schedule();
  refreshAll();
});

browser.alarms.onAlarm.addListener(function (alarm) {
  if (alarm && alarm.name === "poll") refreshAll();
});

function syncFocus() {
  var query = browser.tabs.query({ active: true, lastFocusedWindow: true });
  return Promise.resolve(query).then(function (tabs) {
    var site = tabs && tabs[0] ? serviceForUrl(tabs[0].url) : null;
    if (site === focusedSite) return;
    focusedSite = site;
    return loadSnapshot().then(function (snapshot) {
      reapSnapshot(snapshot, Date.now());
      return paintSnapshot(snapshot);
    });
  }).catch(function () {});
}

browser.tabs.onUpdated.addListener(function (tabId, info, tab) {
  if (tab && tab.active && (info.url || (info && info.status === "complete"))) syncFocus();
  if (!info || info.status !== "complete" || !tab || !tab.url) return;
  var id = serviceForUrl(tab.url);
  if (!id) return;
  setTimeout(function () {
    refreshOne(id);
  }, id === "gemini" ? 1200 : 900);
});

if (browser.windows && browser.windows.onFocusChanged) {
  browser.windows.onFocusChanged.addListener(function (windowId) {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    syncFocus();
  });
}

browser.tabs.onActivated.addListener(function () {
  syncFocus();
});

schedule();
if (typeof installGeminiOriginRule === "function") installGeminiOriginRule();
loadSnapshot().then(function (snapshot) {
  reapSnapshot(snapshot, Date.now());
  return paintSnapshot(snapshot);
}).then(syncFocus);

browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return;
  if (message.type === "get-state") {
    loadSnapshot().then(function (snapshot) {
      reapSnapshot(snapshot, Date.now());
      sendResponse(snapshot);
    });
    return true;
  }
  if (message.type === "refresh") {
    refreshAll().then(function (snapshot) {
      sendResponse(snapshot);
    });
    return true;
  }
  if (message.type === "sent" && AIAdapters[message.service]) {
    refreshOne(message.service);
    setTimeout(function () {
      refreshOne(message.service);
    }, 3000);
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "reap") {
    loadSnapshot().then(function (snapshot) {
      reapSnapshot(snapshot, Date.now());
      return saveSnapshot(snapshot).then(function () {
        return paintSnapshot(snapshot);
      }).then(function () {
        sendResponse(snapshot);
      });
    });
    return true;
  }
  if (message.type === "manual-save") {
    saveManual(message).then(sendResponse);
    return true;
  }
  if (message.type === "manual-forget") {
    browser.storage.local.remove("manual").then(function () {
      return saveTokens({ grokPercent: null, grokLabel: "Paste a team id and management key.", grokCents: 0, grokError: "" });
    }).then(function () {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "set-theme") {
    loadSnapshot().then(function (snapshot) {
      if (message.type === "set-theme") snapshot.theme = message.theme || "auto";
      reapSnapshot(snapshot, Date.now());
      return saveSnapshot(snapshot).then(function () {
        return paintSnapshot(snapshot);
      }).then(function () {
        sendResponse(snapshot);
      });
    });
    return true;
  }
  if (message.type === "observed") {
    var id = classifyObserved(message.url);
    if (!id || !AIAdapters[id] || typeof AIAdapters[id].ingest !== "function") {
      sendResponse({ ok: false });
      return true;
    }
    var reading = AIAdapters[id].ingest(message);
    if (!reading) {
      sendResponse({ ok: true });
      return true;
    }
    loadSnapshot().then(function (snapshot) {
      commitService(snapshot, id, reading);
      reapSnapshot(snapshot, Date.now());
      return saveSnapshot(snapshot).then(function () {
        return paintSnapshot(snapshot);
      }).then(function () {
        sendResponse({ ok: true });
      });
    });
    return true;
  }
  return;
});
