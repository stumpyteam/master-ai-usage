var AIAdapters = globalThis.AIAdapters || (globalThis.AIAdapters = {});

function grokStatusReading(status, payload, isProto) {
  if (status === 401 || status === 403) return { kind: "signed-out" };
  if (status == null || status >= 500 || status === 0) return { kind: "transient", note: "Could not reach Grok" };
  if (status >= 400) return { kind: "transient", note: "Grok returned " + status };
  if (isProto) return readingFromProto(payload);
  return readingFromCredits(payload);
}

async function grokCookieHeader() {
  if (!browser.cookies || !browser.cookies.getAll) return null;
  var jar = await browser.cookies.getAll({ url: "https://grok.com/" });
  if (!jar || !jar.length) return "";
  return jar
    .map(function (cookie) {
      return cookie.name + "=" + cookie.value;
    })
    .join("; ");
}

async function grokAuthHeaders(extra) {
  var headers = {
    Origin: "https://grok.com",
    Referer: "https://grok.com/",
  };
  if (extra) {
    for (var key in extra) headers[key] = extra[key];
  }
  var cookie = null;
  try {
    cookie = await grokCookieHeader();
  } catch (err) {
    cookie = null;
  }
  if (cookie === "") cookie = null;
  if (cookie) headers.Cookie = cookie;
  return { signedOut: false, headers: headers };
}

function xhrPost(url, headers, body) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.responseType = "arraybuffer";
    xhr.timeout = 12000;
    var names = Object.keys(headers || {});
    for (var i = 0; i < names.length; i++) {
      try {
        xhr.setRequestHeader(names[i], headers[names[i]]);
      } catch (err) {
        /* Firefox may refuse Cookie or Origin on XHR */
      }
    }
    xhr.onload = function () {
      resolve({ status: xhr.status, bytes: new Uint8Array(xhr.response || []) });
    };
    xhr.onerror = function () {
      reject(new Error("xhr"));
    };
    xhr.ontimeout = function () {
      reject(new Error("timeout"));
    };
    xhr.send(body);
  });
}

async function postGrok(url, headers, body, asText) {
  try {
    var init = { method: "POST", headers: headers, body: body, cache: "no-store" };
    if (!headers.Cookie) init.credentials = "include";
    var res = await fetch(url, init);
    if (asText) {
      var text = "";
      try {
        text = await res.text();
      } catch (err) {
        text = "";
      }
      return { status: res.status, text: text };
    }
    var bytes = new Uint8Array();
    try {
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      bytes = new Uint8Array();
    }
    return { status: res.status, bytes: bytes };
  } catch (err) {
    var xhr = await xhrPost(url, headers, body);
    if (asText) {
      var decoded = "";
      try {
        decoded = new TextDecoder().decode(xhr.bytes);
      } catch (decodeErr) {
        decoded = "";
      }
      return { status: xhr.status, text: decoded };
    }
    return { status: xhr.status, bytes: xhr.bytes };
  }
}

async function fetchGrokRest() {
  var auth = await grokAuthHeaders({
    accept: "application/json",
    "content-type": "application/json",
  });
  if (auth.signedOut) return { status: 401, text: "", proto: false };
  var result = await postGrok("https://grok.com/rest/grok/credits", auth.headers, "{}", true);
  return { status: result.status, text: result.text || "", proto: false };
}

async function fetchGrokGrpc() {
  var auth = await grokAuthHeaders({
    accept: "application/grpc-web+proto",
    "content-type": "application/grpc-web+proto",
    "x-grpc-web": "1",
  });
  if (auth.signedOut) return { status: 401, bytes: new Uint8Array(), proto: true };
  var result = await postGrok(
    "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
    auth.headers,
    new Uint8Array([0, 0, 0, 0, 0]),
    false,
  );
  return { status: result.status, bytes: result.bytes || new Uint8Array(), proto: true };
}

function hasPercent(reading) {
  return !!(reading && reading.kind === "reading" && reading.percent != null);
}

function firstUseful(current, next) {
  var chosen = null;
  if (hasPercent(next)) chosen = next;
  else if (hasPercent(current)) chosen = current;
  else if (next && next.kind === "signed-out") chosen = next;
  else if (current && current.kind === "signed-out") chosen = current;
  else if (next && next.kind === "reading") chosen = next;
  else chosen = current || next;
  if (!chosen || chosen.kind !== "reading") return chosen;
  if (chosen.products && chosen.products.length) return chosen;
  var other = chosen === next ? current : next;
  if (!other || !other.products || !other.products.length) return chosen;
  var merged = {};
  for (var key in chosen) merged[key] = chosen[key];
  merged.products = other.products.slice();
  return merged;
}

function readingFromTab(fromTab) {
  var reading = null;
  if (fromTab && fromTab.proto) {
    try {
      reading = readingFromProto(base64ToBytes(fromTab.proto));
    } catch (err) {
      reading = null;
    }
  }
  if (fromTab && fromTab.text != null && fromTab.status) {
    reading = firstUseful(reading, grokStatusReading(fromTab.status, fromTab.text, false));
  }
  return reading;
}

function tabTimeout(promise, ms) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    Promise.resolve(promise).then(
      function (value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

AIAdapters.grok = {
  id: "grok",
  label: "Grok",
  match: ["https://grok.com/*", "https://*.grok.com/*", "https://grok.x.com/*"],
  async pull() {
    var reading = null;
    var sawTab = false;
    try {
      var fromTab = await tabTimeout(askTab(this.match, this.id), 8000);
      if (fromTab && !fromTab.error && !fromTab.kind) {
        sawTab = true;
        reading = readingFromTab(fromTab);
      }
    } catch (err) {
      reading = null;
    }
    if (!hasPercent(reading) && (!reading || reading.kind !== "signed-out")) {
      try {
        var rest = await fetchGrokRest();
        reading = firstUseful(reading, grokStatusReading(rest.status, rest.text, false));
      } catch (err) {
        reading = reading || { kind: "transient", note: "Could not reach Grok" };
      }
    }
    if (!hasPercent(reading) && (!reading || reading.kind !== "signed-out")) {
      try {
        var grpc = await fetchGrokGrpc();
        if (grpc.status === 401 || grpc.status === 403) reading = { kind: "signed-out" };
        else if (grpc.status === 200) reading = firstUseful(reading, readingFromProto(grpc.bytes));
      } catch (err) {
        /* keep the earlier result */
      }
    }
    if (reading && reading.kind === "transient" && !sawTab) {
      var cookies = null;
      try {
        cookies = await grokCookieHeader();
      } catch (err) {
        cookies = null;
      }
      if (cookies) reading.note = "Open grok.com and leave that tab open.";
    }
    return reading || { kind: "transient", note: "Could not reach Grok" };
  },
  ingest(message) {
    if (message.status === 401 || message.status === 403) return { kind: "signed-out" };
    var reading = null;
    if (message.encoding === "base64" && message.body) {
      try {
        reading = readingFromProto(base64ToBytes(message.body));
      } catch (err) {
        return null;
      }
    } else if (message.body) {
      reading = readingFromCredits(message.body);
    }
    if (!reading || reading.percent == null) return null;
    return reading;
  },
};
