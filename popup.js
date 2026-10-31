(function () {
  var browserApi = globalThis.browser || globalThis.chrome;
  var demo = /(?:\?|&)demo=1(?:&|$)/.test(location.search);
  var isFirefox = !!(globalThis.browser && globalThis.browser.runtime && typeof globalThis.browser.runtime.getBrowserInfo === "function");
  if (!demo && !isFirefox) document.documentElement.classList.add("scroll");
  var state = null;
  var lastToolbar = undefined;

  function esc(value) {
    var amp = String.fromCharCode(38);
    return String(value == null ? "" : value)
      .split(amp)
      .join(amp + "amp;")
      .split("<")
      .join(amp + "lt;")
      .split(">")
      .join(amp + "gt;")
      .split('"')
      .join(amp + "quot;");
  }

  function rgb(percent) {
    var color = usageColor(percent == null ? 0 : percent);
    return "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
  }

  function future(ms) {
    return new Date(Date.now() + ms).toISOString();
  }

  function defaultDemo() {
    var snap = defaultSnapshot();
    snap.theme = "dark";
    snap.services.grok = {
      id: "grok",
      label: "Grok",
      signedIn: true,
      percent: 42,
      resetsAt: future(4 * 24 * 60 * 60 * 1000),
      periodMs: WEEK_MS,
      products: [
        { name: "Chat", percent: 18 },
        { name: "Build", percent: 12 },
        { name: "Imagine", percent: 3 },
      ],
      note: "",
      plan: "",
      checkedAt: Date.now(),
      lastError: "",
    };
    snap.services.gemini = {
      id: "gemini",
      label: "Gemini",
      signedIn: true,
      percent: null,
      resetsAt: null,
      periodMs: null,
      products: [],
      note: "Signed in, usage not exposed",
      plan: "",
      checkedAt: Date.now(),
      lastError: "",
    };
    snap.services.chatgpt = {
      id: "chatgpt",
      label: "ChatGPT",
      signedIn: true,
      percent: 18,
      resetsAt: future(3 * 60 * 60 * 1000),
      periodMs: 5 * 60 * 60 * 1000,
      products: [
        { name: "5-Hour Window", percent: 18 },
        { name: "Weekly Window", percent: 7 },
      ],
      note: "",
      plan: "Plus",
      checkedAt: Date.now(),
      lastError: "",
    };
    return snap;
  }

  function applyPatch(patch) {
    if (!patch || !state) return;
    if (patch.theme) state.theme = patch.theme;
    if (typeof patch.grokPercent === "number") {
      var grok = state.services.grok;
      grok.signedIn = true;
      grok.percent = patch.grokPercent;
      grok.note = "";
      grok.products = [
        { name: "Chat", percent: Math.round(patch.grokPercent * 0.45) },
        { name: "Build", percent: Math.round(patch.grokPercent * 0.3) },
        { name: "Imagine", percent: Math.max(0, Math.round(patch.grokPercent * 0.25)) },
      ];
      if (!patch.grokClosed) grok.resetsAt = future(4 * 24 * 60 * 60 * 1000);
      grok.periodMs = WEEK_MS;
    }
    if (patch.grokClosed === true) state.services.grok.resetsAt = new Date(Date.now() - 86400000).toISOString();
    if (patch.grokClosed === false && state.services.grok.resetsAt) {
      if (Date.parse(state.services.grok.resetsAt) <= Date.now()) state.services.grok.resetsAt = future(4 * 24 * 60 * 60 * 1000);
    }
    if (typeof patch.chatgptPercent === "number") {
      var chat = state.services.chatgpt;
      chat.signedIn = true;
      chat.percent = patch.chatgptPercent;
      chat.note = "";
      chat.products = [
        { name: "5-Hour Window", percent: patch.chatgptPercent },
        { name: "Weekly Window", percent: Math.max(0, Math.round(patch.chatgptPercent * 0.4)) },
      ];
      chat.resetsAt = future(3 * 60 * 60 * 1000);
      chat.periodMs = 5 * 60 * 60 * 1000;
      chat.plan = "Plus";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "geminiPercent")) {
      var gemini = state.services.gemini;
      gemini.signedIn = true;
      if (patch.geminiPercent == null) {
        gemini.percent = null;
        gemini.products = [];
        gemini.resetsAt = null;
        gemini.note = "Signed in, usage not exposed";
      } else {
        gemini.percent = patch.geminiPercent;
        gemini.note = "";
        gemini.periodMs = 5 * 60 * 60 * 1000;
        gemini.resetsAt = future(2 * 60 * 60 * 1000);
        gemini.products = [
          { name: "Current Window", percent: patch.geminiPercent },
          { name: "Weekly", percent: Math.max(0, Math.round(patch.geminiPercent * 0.5)) },
        ];
      }
    }
  }

  function postUp(height) {
    if (!demo || !window.parent || window.parent === window) return;
    var measured = height || Math.ceil(document.body.scrollHeight);
    window.parent.postMessage(
      {
        source: "ai-usage-popup",
        toolbar: toolbarPercent(state, Date.now()),
        theme: state.theme,
        height: measured,
      },
      location.origin,
    );
  }

  function fitPopup() {
    var root = document.documentElement;
    var body = document.body;
    root.style.overflow = "visible";
    body.style.overflow = "visible";
    root.style.height = "auto";
    body.style.height = "auto";
    root.style.minHeight = "0";
    body.style.minHeight = "0";
    var pad = parseFloat(getComputedStyle(body).paddingBottom) || 0;
    var box = body.getBoundingClientRect();
    var bottom = box.top;
    var nodes = body.children;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].tagName === "SCRIPT") continue;
      var rect = nodes[i].getBoundingClientRect();
      if (rect.bottom > bottom) bottom = rect.bottom;
    }
    var height = Math.ceil(bottom - box.top + pad);
    var needsScroll = !demo && (!isFirefox || height > 600);
    if (needsScroll) {
      body.classList.add("overflow");
      root.style.height = "auto";
      body.style.height = "auto";
      root.style.minHeight = "0";
      body.style.minHeight = "0";
      root.style.maxHeight = "none";
      body.style.maxHeight = "600px";
      root.style.overflow = "hidden";
      body.style.overflowX = "hidden";
      body.style.overflowY = "auto";
      body.style.width = "320px";
      return;
    }
    body.classList.remove("overflow");
    if (height > 40) {
      root.style.height = height + "px";
      body.style.height = height + "px";
      root.style.minHeight = height + "px";
      body.style.minHeight = height + "px";
    }
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.width = "321px";
    void body.offsetWidth;
    body.style.width = "320px";
    if (demo) postUp(height);
  }

  function statusLine(view) {
    if (view.percent != null) return "";
    if (view.note) return view.note;
    if (view.signedIn) return "Signed in, usage not exposed";
    if (view.id === "grok") return "Sign in on grok.com in this Firefox.";
    if (view.id === "gemini") return "Sign in on gemini.google.com in this Firefox.";
    if (view.id === "chatgpt") return "Sign in on chatgpt.com in this Firefox.";
    if (view.id === "claude") return "Sign in on claude.ai in this Firefox.";
    return "Sign in on claude.ai in this Firefox.";
  }

  function renderService(service) {
    var view = decorateService(service, Date.now());
    var rounded = view.percent == null ? null : Math.round(view.percent);
    var ink = rounded == null ? "var(--faint)" : rgb(view.percent);
    var width = rounded == null ? 0 : Math.max(0, Math.min(100, view.percent));
    var reset = "";
    if (view.displayResetsAt) {
      var when = formatWhen(view.displayResetsAt);
      var lead = view.periodClosed ? (view.id === "grok" || view.periodMs === WEEK_MS ? "New week starts " : "Next reset ") : "Resets ";
      reset = '<p class="faint reset">' + lead + esc(when) + "</p>";
    }
    var products = "";
    var rows = (view.products || []).filter(function (row) {
      return row && row.percent > 0;
    });
    var showRows = view.id === "grok" || paid;
    if (showRows && rows.length) {
      products =
        "<ul>" +
        rows
          .map(function (row) {
            return "<li><span>" + esc(row.name) + "</span><span>" + esc(Math.round(row.percent)) + "%</span></li>";
          })
          .join("") +
        "</ul>";
    }
    var status = statusLine(view);
    var statusHtml = status ? '<p class="muted">' + esc(status) + "</p>" : "";
    var planName = String(view.plan || "").trim();
    if (/^free$/i.test(planName)) planName = "Free Tier";
    var planHtml = paid && view.id !== "grok" && planName ? '<p class="faint">' + esc(planName) + "</p>" : "";
    var err = view.lastError && view.percent != null ? '<p class="error">Last check failed</p>' : "";
    return (
      '<section class="svc"><header class="row"><h2>' +
      esc(view.label) +
      "</h2>" +
      reset +
      '<p class="pct" style="color:' +
      ink +
      '">' +
      (rounded == null ? "—" : esc(rounded) + "%") +
      "</p></header>" +
      statusHtml +
      '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      esc(rounded == null ? 0 : rounded) +
      '" aria-label="' +
      esc(view.label) +
      ' usage"><div class="bar" style="width:' +
      width +
      "%;background:" +
      (rounded == null ? "var(--line)" : rgb(view.percent)) +
      '"></div></div>' +
      planHtml +
      products +
      err +
      "</section>"
    );
  }

  function renderThemes() {
    var choice = state.theme || "auto";
    var buttons = document.querySelectorAll("#theme button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-choice") === choice ? "true" : "false");
    }
  }

  var paid = false;
  var tokens = {};
  var entryMode = "fields";
  var curlConnected = false;

  function paintTokenBar(percent) {
    var pct = document.getElementById("token-pct");
    var bar = document.getElementById("token-bar");
    if (!pct || !bar) return;
    var rounded = percent == null || !isFinite(percent) ? null : Math.round(percent);
    pct.textContent = rounded == null ? "—" : rounded + "%";
    pct.style.color = rounded == null ? "var(--faint)" : rgb(percent);
    bar.style.width = rounded == null ? "0%" : Math.max(0, Math.min(100, percent)) + "%";
    bar.style.background = rounded == null ? "var(--line)" : rgb(percent);
  }

  function showCurlForm(open) {
    document.getElementById("curl-box").hidden = !open;
    document.getElementById("fields").hidden = !open || entryMode !== "fields";
    document.getElementById("curl-alt").hidden = !open || entryMode !== "curl";
    document.getElementById("use-curl").hidden = !open || entryMode !== "fields";
    document.getElementById("use-fields").hidden = !open || entryMode !== "curl";
    document.getElementById("curl-actions").hidden = open || !curlConnected;
  }

  function renderTokens() {
    var paywall = document.getElementById("paywall");
    var open = document.getElementById("token-open");
    var note = document.getElementById("token-note");
    if (!paywall || !open || !note) return;
    paywall.hidden = paid;
    open.hidden = !paid;
    document.getElementById("tokens").hidden = !paid;
    if (!paid) {
      paintTokenBar(null);
      document.getElementById("token-track").hidden = true;
      note.hidden = true;
      note.textContent = "";
      return;
    }
    var percent = typeof tokens.grokPercent === "number" ? tokens.grokPercent : null;
    paintTokenBar(percent);
    document.getElementById("token-track").hidden = percent == null;
    var label = tokens.grokLabel || "";
    if (/paste a team id/i.test(label)) label = "";
    note.hidden = !label;
    note.textContent = label;
    var chat = state && state.services && state.services.chatgpt;
    document.getElementById("token-rows").innerHTML =
      chat && chat.tokenNote ? "<li><span>ChatGPT</span><span>" + esc(chat.tokenNote) + "</span></li>" : "";
    var err = document.getElementById("curl-error");
    if (tokens.grokError) {
      err.hidden = false;
      err.textContent = tokens.grokError;
    }
  }

  function setPaid(on) {
    paid = on;
    render();
  }

  function payFail(message) {
    var err = document.getElementById("pay-error");
    err.hidden = false;
    err.textContent = message;
  }

  function render() {
    if (!state) return;
    applyTheme(state.theme || "auto");
    renderThemes();
    document.getElementById("grok").innerHTML = renderService(state.services.grok);
    document.getElementById("list").innerHTML = SERVICE_ORDER.filter(function (id) {
      return id !== "grok";
    })
      .map(function (id) {
        return renderService(state.services[id]);
      })
      .join("");
    document.getElementById("fine").textContent = demo
      ? "Preview sample. Install the extension to read your accounts."
      : "Read only. Nothing leaves this browser.";
    renderTokens();
    fitPopup();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(fitPopup);
    setTimeout(fitPopup, 50);
  }

  function setTheme(theme) {
    state.theme = theme;
    applyTheme(theme);
    render();
    if (demo) return;
    browserApi.runtime.sendMessage({ type: "set-theme", theme: theme });
  }

  document.getElementById("theme").addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) return;
    setTheme(button.getAttribute("data-choice"));
  });

  document.getElementById("buy").addEventListener("click", function () {
    var url = globalThis.GROK_PAY && GROK_PAY.checkoutUrl;
    if (!url) {
      payFail("Checkout is not connected yet.");
      return;
    }
    if (demo || !browserApi.tabs) window.open(url, "_blank", "noopener");
    else browserApi.tabs.create({ url: url });
  });

  document.getElementById("activate").addEventListener("click", function () {
    var input = document.getElementById("license");
    var code = input.value.trim();
    if (code.split(".").length !== 2) {
      payFail("Paste the unlock code from the receipt page.");
      return;
    }
    verifyUnlock(code).then(function (payload) {
      if (!payload) {
        payFail("That unlock code is not valid.");
        return;
      }
      document.getElementById("pay-error").hidden = true;
      input.value = "";
      if (!demo && browserApi.storage) browserApi.storage.local.set({ license: { key: code, at: Date.now() } });
      setPaid(true);
    });
  });

  function writeDraft() {
    if (demo || !browserApi.storage) return;
    browserApi.storage.local.set({
      draft: {
        team: document.getElementById("team").value,
        key: document.getElementById("key").value,
        curl: document.getElementById("curl").value,
        mode: entryMode,
      },
    });
  }

  document.getElementById("team").addEventListener("input", writeDraft);
  document.getElementById("key").addEventListener("input", writeDraft);
  document.getElementById("curl").addEventListener("input", writeDraft);
  window.addEventListener("pagehide", writeDraft);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") writeDraft();
  });

  document.getElementById("manual").addEventListener("submit", function (event) {
    event.preventDefault();
    if (demo || !browserApi.runtime) return;
    var err = document.getElementById("curl-error");
    err.hidden = true;
    var message =
      entryMode === "curl"
        ? { type: "manual-save", curl: document.getElementById("curl").value }
        : { type: "manual-save", teamId: document.getElementById("team").value, key: document.getElementById("key").value };
    browserApi.runtime.sendMessage(message).then(function (result) {
      if (!result || !result.ok) {
        err.hidden = false;
        err.textContent = result && result.error ? result.error : "Could not save.";
        return;
      }
      document.getElementById("team").value = "";
      document.getElementById("key").value = "";
      document.getElementById("curl").value = "";
      browserApi.storage.local.remove("draft");
      curlConnected = true;
      showCurlForm(false);
      render();
    });
  });

  document.getElementById("use-curl").addEventListener("click", function () {
    entryMode = "curl";
    showCurlForm(true);
    writeDraft();
  });
  document.getElementById("use-fields").addEventListener("click", function () {
    entryMode = "fields";
    showCurlForm(true);
    writeDraft();
  });
  document.getElementById("replace").addEventListener("click", function () {
    showCurlForm(true);
  });
  document.getElementById("how").addEventListener("click", function () {
    var url = browserApi.runtime && browserApi.runtime.getURL ? browserApi.runtime.getURL("help.html") : "help.html";
    if (demo || !browserApi.tabs) window.open(url, "_blank", "noopener");
    else browserApi.tabs.create({ url: url });
  });
  document.getElementById("forget").addEventListener("click", function () {
    document.getElementById("team").value = "";
    document.getElementById("key").value = "";
    document.getElementById("curl").value = "";
    curlConnected = false;
    showCurlForm(true);
    if (demo || !browserApi.runtime) return;
    browserApi.storage.local.remove("draft");
    browserApi.runtime.sendMessage({ type: "manual-forget" });
  });

  document.getElementById("refresh").addEventListener("click", function () {
    if (demo) {
      render();
      return;
    }
    var button = document.getElementById("refresh");
    button.disabled = true;
    browserApi.runtime.sendMessage({ type: "refresh" }).then(function (snapshot) {
      if (snapshot) state = snapshot;
      button.disabled = false;
      render();
    });
  });

  if (demo) {
    state = defaultDemo();
    watchTheme();
    render();
    window.addEventListener("message", function (event) {
      if (event.origin !== location.origin) return;
      var data = event.data;
      if (!data || data.source !== "ai-usage-demo") return;
      if (data.snapshot) state = data.snapshot;
      applyPatch(data.patch);
      render();
    });
    return;
  }

  watchTheme();
  state = defaultSnapshot();
  render();
  browserApi.storage.local.get(["snapshot", "license", "manual", "draft", "tokens"]).then(function (stored) {
    state = stored && stored.snapshot ? stored.snapshot : defaultSnapshot();
    tokens = stored.tokens || {};
    curlConnected = Boolean(stored.manual && (stored.manual.key || stored.manual.curl));
    if (stored.draft) {
      document.getElementById("team").value = stored.draft.team || "";
      document.getElementById("key").value = stored.draft.key || "";
      document.getElementById("curl").value = stored.draft.curl || "";
      if (stored.draft.mode === "curl" || stored.draft.mode === "fields") entryMode = stored.draft.mode;
    }
    showCurlForm(!curlConnected);
    var key = stored.license && stored.license.key;
    if (!key) {
      render();
      return;
    }
    verifyUnlock(key).then(function (payload) {
      paid = Boolean(payload);
      render();
    });
  });
  browserApi.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes.snapshot) state = changes.snapshot.newValue;
    if (changes.tokens) tokens = changes.tokens.newValue || {};
    if (changes.snapshot || changes.tokens) render();
  });
  browserApi.runtime.sendMessage({ type: "refresh" });
  setInterval(function () {
    render();
    var live = state ? toolbarPercent(state, Date.now()) : null;
    if (live !== lastToolbar) {
      lastToolbar = live;
      browserApi.runtime.sendMessage({ type: "reap" });
    }
  }, 30000);
})();
