(function () {
  if (globalThis.__aiUsageHooked) return;
  globalThis.__aiUsageHooked = true;

  function classify(url) {
    var value = String(url || "");
    if (/\/rest\/grok\/credits|GetGrokCreditsConfig|getGrokCreditsConfig/i.test(value)) return "grok";
    if (/chatgpt\.com/i.test(value) && /\/backend-api\/wham\/usage/i.test(value)) return "chatgpt";
    if (/gemini\.google\.com/i.test(value) && (/usage/i.test(value) || /batchexecute/i.test(value) || /qpEbW/.test(value))) return "gemini";
    if (/claude\.ai/i.test(value) && /\/api\/organizations\/[^/]+\/usage/i.test(value)) return "claude";
    return "";
  }

  function bytesToBase64(bytes) {
    var bin = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function report(url, status, body, encoding) {
    try {
      if (!classify(url)) return;
      if (typeof body === "string" && body.length > 300000) body = body.slice(0, 300000);
      if (encoding === "text" && classify(url) === "gemini") {
        if (!/usedPercent|usagePercent|percentUsed|remainingFraction|%\s*used|jSf9Qc|qpEbW|gxu-/i.test(body || "")) return;
      }
      window.postMessage(
        { source: "ai-usage-tracker", url: String(url), status: status, body: body, encoding: encoding },
        "*",
      );
    } catch (err) {
      /* never break the host page */
    }
  }

  var originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = function () {
      var args = arguments;
      var input = args[0];
      var url = typeof input === "string" ? input : input && input.url ? input.url : "";
      var service = classify(url);
      var pending = originalFetch.apply(this, args);
      if (!service) return pending;
      return pending.then(function (response) {
        try {
          var clone = response.clone();
          var kind = service === "grok" && /GetGrokCreditsConfig/i.test(url) ? "bytes" : "text";
          if (kind === "bytes") {
            clone.arrayBuffer().then(function (buffer) {
              var bytes = new Uint8Array(buffer);
              if (bytes.length && bytes.length < 200000) report(url, response.status, bytesToBase64(bytes), "base64");
            }).catch(function () {});
          } else {
            clone.text().then(function (text) {
              report(url, response.status, text, "text");
            }).catch(function () {});
          }
        } catch (err) {
          /* ignore */
        }
        return response;
      });
    };
  }

  var originalOpen = XMLHttpRequest && XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest && XMLHttpRequest.prototype.send;
  if (originalOpen && originalSend) {
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__aiUsageUrl = url;
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      xhr.addEventListener("load", function () {
        try {
          var url = xhr.__aiUsageUrl || "";
          if (!classify(url)) return;
          if (xhr.responseType === "arraybuffer" && xhr.response) {
            report(url, xhr.status, bytesToBase64(new Uint8Array(xhr.response)), "base64");
            return;
          }
          if (typeof xhr.responseText === "string") report(url, xhr.status, xhr.responseText, "text");
        } catch (err) {
          /* ignore */
        }
      });
      return originalSend.apply(this, arguments);
    };
  }
  function onGrokPage() {
    var host = location.hostname || "";
    return host === "grok.com" || host.endsWith(".grok.com") || host === "grok.x.com";
  }

  function textHasPercent(text) {
    return /creditUsagePercent|credit_usage_percent|usagePercent|usage_percent/i.test(text || "");
  }

  function probeRest() {
    var fetchFn = originalFetch || globalThis.fetch;
    return fetchFn("/rest/grok/credits", {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
    })
      .then(function (res) {
        return res.text().then(function (text) {
          return { status: res.status, body: text || "", encoding: "text", url: res.url || "https://grok.com/rest/grok/credits" };
        });
      })
      .catch(function () {
        return null;
      });
  }

  function probeGrpc() {
    var fetchFn = originalFetch || globalThis.fetch;
    return fetchFn("/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig", {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/grpc-web+proto",
        "content-type": "application/grpc-web+proto",
        "x-grpc-web": "1",
      },
      body: new Uint8Array([0, 0, 0, 0, 0]),
    })
      .then(function (res) {
        return res.arrayBuffer().then(function (buffer) {
          return {
            status: res.status,
            body: bytesToBase64(new Uint8Array(buffer)),
            encoding: "base64",
            url: res.url || "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
          };
        });
      })
      .catch(function () {
        return null;
      });
  }

  function probeGrok() {
    if (!onGrokPage()) return Promise.resolve();
    return Promise.all([probeRest(), probeGrpc()]).then(function (pair) {
      var rest = pair[0];
      var grpc = pair[1];
      if (rest) report(rest.url, rest.status, rest.body, rest.encoding);
      if (grpc) report(grpc.url, grpc.status, grpc.body, grpc.encoding);
      var chosen = null;
      if (rest && rest.status && rest.status < 500 && textHasPercent(rest.body)) chosen = rest;
      else if (grpc && grpc.status === 200 && grpc.body) chosen = grpc;
      else if (rest && rest.status) chosen = rest;
      else if (grpc && grpc.status) chosen = grpc;
      window.postMessage(
        {
          source: "ai-usage-pull",
          service: "grok",
          status: chosen ? chosen.status : 0,
          body: chosen ? chosen.body : "",
          encoding: chosen ? chosen.encoding : "text",
        },
        "*",
      );
    });
  }

  function onGeminiPage() {
    var host = location.hostname || "";
    return host === "gemini.google.com";
  }

  function pickWiz(html, key) {
    var source = String(html || "");
    var re = new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"');
    var match = source.match(re);
    if (match) return match[1].replace(/\\u003d/gi, "=").replace(/\\u0026/gi, "&").replace(/\\"/g, '"');
    var live = globalThis.WIZ_global_data;
    if (live && live[key]) return String(live[key]);
    return "";
  }

  function geminiQuotaCall(fetchFn, prefix, tokens, args) {
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
    return fetchFn(prefix + "/_/BardChatUi/data/batchexecute?" + query.toString(), {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1",
      },
      body: body.toString(),
    }).then(function (res) {
      return res.text().then(function (text) {
        return { status: res.status, text: text || "" };
      });
    });
  }

  function probeGemini() {
    if (!onGeminiPage()) return Promise.resolve();
    var fetchFn = originalFetch || globalThis.fetch;
    var account = (location.pathname || "").match(/^\/u\/\d+/);
    var prefix = account ? account[0] : "";
    function finish(status, body) {
      window.postMessage({ source: "ai-usage-pull", service: "gemini", status: status, body: body || "", encoding: "text" }, "*");
    }
    function withTokens(html) {
      var tokens = {
        buildLabel: pickWiz(html, "cfb2h"),
        sessionId: pickWiz(html, "FdrFJe"),
        requestToken: pickWiz(html, "SNlM0e"),
        locale: pickWiz(html, "GGcqce") || (document.documentElement && document.documentElement.lang) || "en",
      };
      if (!tokens.requestToken) {
        finish(200, html || "");
        return Promise.resolve();
      }
      return Promise.all([
        geminiQuotaCall(fetchFn, prefix, tokens, JSON.stringify([[[1, 2]]])),
        geminiQuotaCall(fetchFn, prefix, tokens, "[]"),
      ]).then(function (pair) {
        var chunks = [];
        var status = 0;
        for (var i = 0; i < pair.length; i++) {
          if (!pair[i]) continue;
          if (pair[i].status) status = pair[i].status;
          if (pair[i].text) chunks.push(pair[i].text);
        }
        finish(status || 200, chunks.join("\n") || html || "");
      });
    }
    if (globalThis.WIZ_global_data && globalThis.WIZ_global_data.SNlM0e) {
      return withTokens("").catch(function () {
        finish(0, "");
      });
    }
    return fetchFn(prefix + "/app", { credentials: "include" })
      .then(function (res) {
        return res.text().then(function (html) {
          return withTokens(html || "");
        });
      })
      .catch(function () {
        finish(0, "");
      });
  }

  if (onGeminiPage()) {
    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      var data = event.data;
      if (!data || data.source !== "ai-usage-ext" || data.type !== "pull-gemini") return;
      probeGemini();
    });
  }

  if (onGrokPage()) {
    window.addEventListener("message", function (event) {
      if (event.source !== window) return;
      var data = event.data;
      if (!data || data.source !== "ai-usage-ext" || data.type !== "pull-grok") return;
      probeGrok();
    });
    window.addEventListener("load", function () {
      setTimeout(probeGrok, 700);
    });
  }
})();
