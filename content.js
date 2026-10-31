(function () {
  var browser = globalThis.browser || globalThis.chrome;
  var sentAt = 0;

  function serviceForHost() {
    var host = location.hostname;
    if (host.indexOf("grok.") >= 0) return "grok";
    if (host.indexOf("gemini.") >= 0) return "gemini";
    if (host.indexOf("claude.ai") >= 0) return "claude";
    return "chatgpt";
  }

  function notifySend() {
    var now = Date.now();
    if (now - sentAt < 2000) return;
    sentAt = now;
    browser.runtime.sendMessage({ type: "sent", service: serviceForHost() }).catch(function () {});
  }

  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      var target = event.target;
      if (!target) return;
      var tag = target.tagName;
      if (tag === "TEXTAREA" || target.isContentEditable || target.getAttribute("role") === "textbox") notifySend();
    },
    true,
  );

  document.addEventListener(
    "click",
    function (event) {
      var node = event.target && event.target.closest ? event.target.closest("button") : null;
      if (!node) return;
      var label = (node.getAttribute("aria-label") || node.getAttribute("data-testid") || node.getAttribute("title") || "").toLowerCase();
      if (/send|submit/.test(label)) notifySend();
    },
    true,
  );

  document.addEventListener(
    "submit",
    function () {
      notifySend();
    },
    true,
  );

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== "ai-usage-tracker") return;
    browser.runtime.sendMessage({
      type: "observed",
      url: data.url,
      status: data.status,
      body: data.body,
      encoding: data.encoding,
    }).catch(function () {});
  });

  function pullGrok() {
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        window.removeEventListener("message", onMsg);
        resolve({ error: "pull failed" });
      }, 7000);
      function onMsg(event) {
        if (event.source !== window) return;
        var data = event.data;
        if (!data || data.source !== "ai-usage-pull" || data.service !== "grok") return;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        resolve({
          status: data.status,
          text: data.encoding === "base64" ? "" : data.body || "",
          proto: data.encoding === "base64" ? data.body || "" : "",
        });
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ source: "ai-usage-ext", type: "pull-grok" }, "*");
    });
  }

  function pullGemini() {
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        window.removeEventListener("message", onMsg);
        resolve({ error: "pull failed" });
      }, 8000);
      function onMsg(event) {
        if (event.source !== window) return;
        var data = event.data;
        if (!data || data.source !== "ai-usage-pull" || data.service !== "gemini") return;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        var domText = "";
        if (document.body) {
          var nodes = document.querySelectorAll("[data-test-id], [aria-valuenow]");
          var extra = [];
          for (var i = 0; i < nodes.length && i < 30; i++) {
            extra.push((nodes[i].getAttribute("data-test-id") || "") + " " + (nodes[i].getAttribute("aria-valuenow") || "") + " " + (nodes[i].innerText || "").slice(0, 160));
          }
          domText = (document.body.innerText || "").slice(0, 12000) + "\n" + extra.join("\n");
        }
        resolve({
          status: data.status,
          finalUrl: location.href,
          text: data.encoding === "base64" ? "" : data.body || "",
          domText: domText,
        });
      }
      window.addEventListener("message", onMsg);
      window.postMessage({ source: "ai-usage-ext", type: "pull-gemini" }, "*");
    });
  }

  async function pullChatGpt() {
    var sessionRes = await fetch("https://chatgpt.com/api/auth/session", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (sessionRes.status === 401 || sessionRes.status === 403) return { kind: "signed-out" };
    if (!sessionRes.ok) return { kind: "transient", note: "Could not reach ChatGPT" };
    var session = await sessionRes.json();
    if (!session || !session.accessToken) return { session: session || {}, usageStatus: 0, usageJson: null };
    var headers = { accept: "application/json", authorization: "Bearer " + session.accessToken };
    if (session.account && session.account.id) headers["chatgpt-account-id"] = session.account.id;
    var usageRes = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      credentials: "include",
      headers: headers,
    });
    var usageJson = null;
    try {
      usageJson = await usageRes.json();
    } catch (err) {
      usageJson = null;
    }
    return { session: { accessToken: true, user: session.user || null, account: session.account || null }, usageStatus: usageRes.status, usageJson: usageJson };
  }

  browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "pull") return;
    var job = message.service === "grok" ? pullGrok() : message.service === "gemini" ? pullGemini() : message.service === "claude" ? Promise.resolve(null) : pullChatGpt();
    job.then(
      function (result) {
        sendResponse(result);
      },
      function () {
        sendResponse({ error: "pull failed" });
      },
    );
    return true;
  });
})();
