// Pure parsers. No network. Never turns a missing field into 0.

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function firstNumber(obj, keys) {
  if (!obj) return null;
  for (var i = 0; i < keys.length; i++) {
    var value = obj[keys[i]];
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && isFinite(Number(value))) return Number(value);
  }
  return null;
}

function labelProduct(name) {
  var key = String(name || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  var map = {
    grokchat: "Chat",
    productgrokchat: "Chat",
    chat: "Chat",
    grokbuild: "Build",
    productgrokbuild: "Build",
    build: "Build",
    grokimagine: "Imagine",
    productgrokimagine: "Imagine",
    imagine: "Imagine",
    grokvoice: "Voice",
    productgrokvoice: "Voice",
    voice: "Voice",
    productapi: "API",
    api: "API",
    grokplugins: "Plugins",
    productgrokplugins: "Plugins",
    plugins: "Plugins",
    grokappbuilder: "App Builder",
    productgrokappbuilder: "App Builder",
    appbuilder: "App Builder",
    groktasks: "Tasks",
    productgroktasks: "Tasks",
    tasks: "Tasks",
    grokbot: "Bot",
    productgrokbot: "Bot",
    bot: "Bot",
    productcursor: "Cursor",
    cursor: "Cursor",
    productbugbot: "Bugbot",
    bugbot: "Bugbot",
  };
  if (map[key]) return map[key];
  var raw = String(name || "Other")
    .replace(/^PRODUCT_/i, "")
    .replace(/^GROK_/i, "")
    .replace(/^Grok/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return raw || "Other";
}

function fractionMode(values) {
  var sawFraction = false;
  for (var i = 0; i < values.length; i++) {
    var value = values[i];
    if (typeof value !== "number" || !isFinite(value)) continue;
    if (value > 1) return false;
    if (value > 0 && value < 1) sawFraction = true;
  }
  return sawFraction;
}

function normalizePercent(value, fraction) {
  if (typeof value !== "number" || !isFinite(value)) return null;
  var n = value;
  if (fraction && n > 0 && n < 1) n = n * 100;
  if (n < 0 || n > 100) return null;
  return n;
}

function parseTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    var parsed = Date.parse(value);
    return isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value === "number" && isFinite(value)) {
    var ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  var obj = asObject(value);
  if (!obj) return null;
  var seconds = obj.seconds != null ? obj.seconds : obj.Seconds;
  if (typeof seconds === "string" && seconds.trim()) seconds = Number(seconds);
  if (typeof seconds === "number" && isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  return null;
}

function rawProducts(list) {
  if (!Array.isArray(list)) return [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var row = asObject(list[i]);
    if (!row) continue;
    var pct = firstNumber(row, ["usagePercent", "usage_percent", "percent"]);
    if (pct == null) continue;
    out.push({ name: labelProduct(row.product || row.name || "Other"), raw: pct });
  }
  return out;
}

function parseCredits(input) {
  var data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch (err) {
      return null;
    }
  }
  data = asObject(data);
  if (!data) return null;
  if (!asObject(data.config) && asObject(data.data)) data = data.data;
  var config = asObject(data.config) || asObject(data.credits) || data;
  var rawProductsList = rawProducts(config.productUsage || config.product_usage);
  var rawPercent = firstNumber(config, ["creditUsagePercent", "credit_usage_percent"]);
  var values = [];
  if (rawPercent != null) values.push(rawPercent);
  for (var i = 0; i < rawProductsList.length; i++) values.push(rawProductsList[i].raw);
  var fraction = fractionMode(values);
  var percent = normalizePercent(rawPercent, fraction);
  var products = [];
  for (var j = 0; j < rawProductsList.length; j++) {
    var scaled = normalizePercent(rawProductsList[j].raw, fraction);
    if (scaled == null) continue;
    products.push({ name: rawProductsList[j].name, percent: scaled });
  }
  var period = asObject(config.currentPeriod) || asObject(config.current_period);
  var resetsAt = null;
  var periodMs = null;
  if (period) {
    resetsAt = parseTime(period.end);
    var type = String(period.type || period.periodType || "");
    if (/WEEK/i.test(type)) periodMs = 7 * 24 * 60 * 60 * 1000;
    else if (/MONTH/i.test(type)) periodMs = 30 * 24 * 60 * 60 * 1000;
    else if (/DAY/i.test(type)) periodMs = 24 * 60 * 60 * 1000;
  }
  if (!resetsAt) resetsAt = parseTime(config.periodEnd || config.period_end || config.resetsAt || config.resets_at);
  return {
    percent: percent,
    resetsAt: resetsAt,
    periodMs: periodMs,
    products: products,
  };
}

function readingFromCredits(json) {
  var parsed = parseCredits(json);
  if (!parsed) return { kind: "transient", note: "Could not read Grok usage" };
  return {
    kind: "reading",
    signedIn: true,
    percent: parsed.percent,
    resetsAt: parsed.resetsAt,
    periodMs: parsed.periodMs || 7 * 24 * 60 * 60 * 1000,
    products: parsed.percent == null ? [] : parsed.products,
    note: parsed.percent == null ? "Signed in, usage not exposed" : "",
  };
}

function readVarint(bytes, offset) {
  var result = 0;
  var shift = 0;
  var next = offset;
  while (next < bytes.length && shift <= 28) {
    var bite = bytes[next++];
    result |= (bite & 0x7f) << shift;
    if ((bite & 0x80) === 0) return { value: result >>> 0, next: next };
    shift += 7;
  }
  return null;
}

function skipField(bytes, offset, wire) {
  if (wire === 0) {
    var value = readVarint(bytes, offset);
    return value ? value.next : null;
  }
  if (wire === 1) return offset + 8 <= bytes.length ? offset + 8 : null;
  if (wire === 5) return offset + 4 <= bytes.length ? offset + 4 : null;
  if (wire === 2) {
    var length = readVarint(bytes, offset);
    if (!length) return null;
    var end = length.next + length.value;
    return end <= bytes.length ? end : null;
  }
  return null;
}

function readLengthDelimited(bytes, fieldNumber) {
  var offset = 0;
  while (offset < bytes.length) {
    var tag = bytes[offset++];
    if (tag === undefined) return null;
    var field = tag >>> 3;
    var wire = tag & 7;
    if (wire === 2) {
      var length = readVarint(bytes, offset);
      if (!length) return null;
      offset = length.next;
      var value = bytes.subarray(offset, offset + length.value);
      offset += length.value;
      if (field === fieldNumber) return value;
      continue;
    }
    var skipped = skipField(bytes, offset, wire);
    if (skipped == null) return null;
    offset = skipped;
  }
  return null;
}

function readFloatField(bytes, fieldNumber) {
  var offset = 0;
  while (offset < bytes.length) {
    var tag = bytes[offset++];
    if (tag === undefined) return null;
    var field = tag >>> 3;
    var wire = tag & 7;
    if (wire === 5) {
      if (offset + 4 > bytes.length) return null;
      var view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
      var value = view.getFloat32(0, true);
      offset += 4;
      if (field === fieldNumber) return value;
      continue;
    }
    var skipped = skipField(bytes, offset, wire);
    if (skipped == null) return null;
    offset = skipped;
  }
  return null;
}

function readTimestampField(bytes, fieldNumber) {
  var nested = readLengthDelimited(bytes, fieldNumber);
  if (!nested) return null;
  var offset = 0;
  var seconds = null;
  while (offset < nested.length) {
    var tag = nested[offset++];
    if (tag === undefined) break;
    var field = tag >>> 3;
    var wire = tag & 7;
    if (wire === 0) {
      var value = readVarint(nested, offset);
      if (!value) break;
      offset = value.next;
      if (field === 1) seconds = value.value;
      continue;
    }
    var skipped = skipField(nested, offset, wire);
    if (skipped == null) break;
    offset = skipped;
  }
  if (seconds == null) return null;
  return new Date(seconds * 1000).toISOString();
}

function firstGrpcMessage(bytes) {
  if (!bytes || bytes.length < 5) return bytes && bytes.length ? bytes : null;
  var offset = 0;
  var sawFrame = false;
  while (offset + 5 <= bytes.length) {
    var flag = bytes[offset];
    var length = (bytes[offset + 1] << 24) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 8) | bytes[offset + 4];
    if (length < 0 || offset + 5 + length > bytes.length) break;
    sawFrame = true;
    var frame = bytes.subarray(offset + 5, offset + 5 + length);
    offset += 5 + length;
    if (flag === 0x80) continue;
    if (flag !== 0) continue;
    return frame;
  }
  return sawFrame ? null : bytes;
}

function eachField(bytes, visit) {
  var offset = 0;
  while (offset < bytes.length) {
    var tag = bytes[offset++];
    if (tag === undefined) return;
    var field = tag >>> 3;
    var wire = tag & 7;
    if (wire === 0) {
      var value = readVarint(bytes, offset);
      if (!value) return;
      offset = value.next;
      visit(field, wire, value.value);
      continue;
    }
    if (wire === 5) {
      if (offset + 4 > bytes.length) return;
      var view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
      var floatValue = view.getFloat32(0, true);
      offset += 4;
      visit(field, wire, floatValue);
      continue;
    }
    if (wire === 1) {
      if (offset + 8 > bytes.length) return;
      var wide = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
      var doubleValue = wide.getFloat64(0, true);
      offset += 8;
      visit(field, wire, doubleValue);
      continue;
    }
    if (wire === 2) {
      var length = readVarint(bytes, offset);
      if (!length) return;
      var start = length.next;
      var end = start + length.value;
      if (end > bytes.length) return;
      visit(field, wire, bytes.subarray(start, end));
      offset = end;
      continue;
    }
    return;
  }
}

var GROK_PRODUCT_BY_ID = {
  1: "API",
  2: "Build",
  3: "Plugins",
  4: "Chat",
  5: "Imagine",
  6: "Voice",
  7: "App Builder",
  8: "Tasks",
  9: "Bot",
  10: "Cursor",
  11: "Bugbot",
};

function parseGrokProduct(bytes) {
  var id = 0;
  var used = null;
  eachField(bytes, function (field, wire, value) {
    if (field === 1 && wire === 0) id = value;
    if (field === 2 && (wire === 5 || wire === 1) && isFinite(value)) used = value;
  });
  var percent = normalizePercent(used, false);
  if (percent == null || percent <= 0) return null;
  return { name: GROK_PRODUCT_BY_ID[id] || "Other", percent: percent };
}

function parseGrokProto(input) {
  var bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  var message = firstGrpcMessage(bytes);
  if (!message || !message.length) return null;
  var config = readLengthDelimited(message, 1) || message;
  var used = readFloatField(config, 1);
  if (used == null || !isFinite(used)) return { percent: null, resetsAt: null, periodMs: 7 * 24 * 60 * 60 * 1000, products: [] };
  var percent = normalizePercent(used, false);
  var resetsAt = readTimestampField(config, 5) || readTimestampField(config, 4);
  var products = [];
  eachField(config, function (field, wire, value) {
    if (field !== 7 || wire !== 2) return;
    var row = parseGrokProduct(value);
    if (row) products.push(row);
  });
  return {
    percent: percent,
    resetsAt: resetsAt,
    periodMs: 7 * 24 * 60 * 60 * 1000,
    products: percent == null ? [] : products,
  };
}

function readingFromProto(bytes) {
  var parsed = parseGrokProto(bytes);
  if (!parsed) return { kind: "transient", note: "Could not read Grok usage" };
  return {
    kind: "reading",
    signedIn: true,
    percent: parsed.percent,
    resetsAt: parsed.resetsAt,
    periodMs: parsed.periodMs,
    products: parsed.products || [],
    note: parsed.percent == null ? "Signed in, usage not exposed" : "",
  };
}

function windowName(seconds) {
  if (seconds == null) return "Window";
  var hours = seconds / 3600;
  if (hours >= 4 && hours <= 6) return "5-Hour Window";
  if (hours >= 20 && hours <= 28) return "Daily Window";
  if (hours >= 144 && hours <= 192) return "Weekly Window";
  if (hours >= 600 && hours <= 800) return "Monthly Window";
  if (hours < 48) return Math.round(hours) + "-Hour Window";
  return Math.round(hours / 24) + "-Day Window";
}

function readLimitWindow(windowObj) {
  var row = asObject(windowObj);
  if (!row) return null;
  var pct = firstNumber(row, ["used_percent", "usedPercent"]);
  if (pct == null) return null;
  var percent = normalizePercent(pct, false);
  if (percent == null) return null;
  var label = "";
  if (typeof row.name === "string") label = row.name;
  else if (typeof row.title === "string") label = row.title;
  else if (typeof row.label === "string") label = row.label;
  return {
    percent: percent,
    seconds: firstNumber(row, ["limit_window_seconds", "window_seconds"]),
    resetAt: firstNumber(row, ["reset_at", "resetAt"]),
    resetAfter: firstNumber(row, ["reset_after_seconds", "resetAfterSeconds"]),
    name: label.replace(/_/g, " ").trim(),
  };
}

function resetFromWindow(row, now) {
  if (!row) return null;
  if (row.resetAt != null) {
    var ms = row.resetAt < 1e12 ? row.resetAt * 1000 : row.resetAt;
    return new Date(ms).toISOString();
  }
  if (row.resetAfter != null) return new Date(now + row.resetAfter * 1000).toISOString();
  return null;
}

function chatTokenNote(data) {
  var credits = asObject(data && data.credits);
  if (!credits) return "";
  var parts = [];
  if (credits.unlimited === true) parts.push("Unlimited");
  else if (credits.balance != null && credits.balance !== "") parts.push("Balance " + credits.balance);
  function approx(node, label) {
    if (typeof node === "number" && isFinite(node)) {
      parts.push(label + " " + Math.round(node));
      return;
    }
    var row = asObject(node);
    if (!row) return;
    var count = firstNumber(row, ["count", "messages", "value", "approx"]);
    if (count != null) parts.push(label + " " + Math.round(count));
  }
  approx(credits.approx_local_messages, "Local messages");
  approx(credits.approx_cloud_messages, "Cloud messages");
  return parts.join(" · ");
}

function moneyCents(node) {
  if (typeof node === "number" || typeof node === "string") {
    var amount = Number(node);
    return isFinite(amount) ? amount : null;
  }
  if (!node || typeof node !== "object") return null;
  return moneyCents(node.val != null ? node.val : node.value);
}

function prepaidView(body) {
  var bag = body && body.balance && typeof body.balance === "object" ? body.balance : body || {};
  var signed = moneyCents(bag.total != null ? bag.total : bag.prepaidBalance);
  var available = signed == null ? null : -signed;
  var changes = Array.isArray(bag.changes) ? bag.changes : [];
  var added = 0;
  var spent = 0;
  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    var cents = moneyCents(change && change.amount);
    var origin = String((change && (change.changeOrigin || change.origin)) || "");
    if (cents == null) continue;
    if (/SPEND/.test(origin)) spent += Math.abs(cents);
    else if (/PURCHASE|MANUAL|AUTO|REFUND/.test(origin) && cents < 0) added += -cents;
  }
  var percent = null;
  if (available != null && added > 0) {
    var used = Math.max(0, added - Math.max(0, available));
    percent = Math.max(0, Math.min(100, Math.round((used / added) * 100)));
  } else if (available != null && spent > 0) {
    var pool = spent + Math.max(0, available);
    percent = pool > 0 ? Math.max(0, Math.min(100, Math.round((spent / pool) * 100))) : null;
  }
  var dollars = available == null ? null : Math.abs(available) / 100;
  var account = dollars == null ? "API key" : available < 0 ? "Over by $" + dollars.toFixed(2) : "$" + dollars.toFixed(2) + " left";
  return {
    percent: percent,
    account: account,
    prepaidCents: available != null && available > 0 ? available : 0,
  };
}

function parseShell(raw) {
  var text = String(raw || "").replace(/\\\s*\r?\n/g, " ");
  var team = text.match(/\/teams\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  var bearer = text.match(/bearer\s+([A-Za-z0-9._~+/-]+)/i);
  if (!bearer || bearer[1].length < 8) return { error: "No Bearer token in that curl." };
  return { teamId: team ? team[1] : "", key: bearer[1] };
}

function parseChatGptUsage(input, now) {
  var data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch (err) {
      return null;
    }
  }
  data = asObject(data);
  if (!data) return null;
  var rate = asObject(data.rate_limit) || asObject(data.rateLimit) || data;
  var windows = [];
  var ordered = [];
  var primary = readLimitWindow(rate.primary_window || rate.primaryWindow);
  var secondary = readLimitWindow(rate.secondary_window || rate.secondaryWindow);
  if (primary) {
    windows.push(primary);
    ordered.push(primary);
  }
  if (secondary) {
    windows.push(secondary);
    ordered.push(secondary);
  }
  var extra = rate.additional_rate_limits || rate.additionalRateLimits;
  if (Array.isArray(extra)) {
    for (var i = 0; i < extra.length; i++) {
      var extraWindow = readLimitWindow(extra[i]);
      if (extraWindow) {
        windows.push(extraWindow);
        ordered.push(extraWindow);
      }
    }
  }
  if (!windows.length) {
    return {
      percent: null,
      resetsAt: null,
      periodMs: null,
      products: [],
      plan: data.plan_type || data.planType || "",
      tokenNote: chatTokenNote(data),
    };
  }
  var headline = windows[0];
  for (var j = 1; j < windows.length; j++) {
    if (windows[j].percent > headline.percent) headline = windows[j];
  }
  var products = [];
  for (var k = 0; k < ordered.length; k++) {
    products.push({
      name: ordered[k].name || windowName(ordered[k].seconds),
      percent: ordered[k].percent,
    });
  }
  return {
    percent: headline.percent,
    resetsAt: resetFromWindow(headline, now == null ? Date.now() : now),
    periodMs: headline.seconds != null ? headline.seconds * 1000 : null,
    products: products,
    plan: data.plan_type || data.planType || "",
    tokenNote: chatTokenNote(data),
  };
}

function parseRelativeReset(text, now) {
  if (!/reset|refresh/i.test(text)) return null;
  var hours = /(\d+)\s*h(?:ours?|r)?/i.exec(text);
  var minutes = /(\d+)\s*m(?:inutes?|in)?/i.exec(text);
  if (!hours && !minutes) return null;
  var ms = 0;
  if (hours) ms += Number(hours[1]) * 60 * 60 * 1000;
  if (minutes) ms += Number(minutes[1]) * 60 * 1000;
  if (!(ms > 0)) return null;
  return new Date(now + ms).toISOString();
}

function labelFromContext(context) {
  var text = context.toLowerCase();
  function last(words) {
    var best = -1;
    for (var i = 0; i < words.length; i++) {
      var at = text.lastIndexOf(words[i]);
      if (at > best) best = at;
    }
    return best;
  }
  var weekly = last(["weekly", "7-day", "7 day", "per week", "this week"]);
  var current = last(["5-hour", "5 hour", "current window", "current limit", "session"]);
  if (weekly < 0 && current < 0) return "Usage";
  if (weekly > current) return "Weekly";
  return "Current Window";
}

function periodMsForLabel(label) {
  if (label === "Weekly") return 7 * 24 * 60 * 60 * 1000;
  if (label === "Current Window") return 5 * 60 * 60 * 1000;
  return null;
}

function pushProduct(products, name, percent, resetsAt, periodMs) {
  if (percent == null || percent < 0 || percent > 100) return;
  for (var i = 0; i < products.length; i++) {
    if (products[i].name === name) return;
  }
  products.push({ name: name, percent: percent, resetsAt: resetsAt || null, periodMs: periodMs });
}

function geminiStamp(value) {
  if (!Array.isArray(value) || !value.length) return null;
  var head = value[0];
  if (Array.isArray(head)) head = head[0];
  if (Array.isArray(head)) head = head[0];
  var seconds = Number(head);
  if (!isFinite(seconds) || seconds < 1e9) return null;
  return new Date(seconds * 1000).toISOString();
}

function parseGeminiQuotaRows(rows, now) {
  var products = [];
  var compute = [];
  var others = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!Array.isArray(row)) continue;
    var pct = normalizePercent(Number(row[2]), false);
    if (pct == null) continue;
    var ctx = Array.isArray(row[0]) ? row[0] : [];
    var entry = { pct: pct, resetsAt: geminiStamp(row[3]), action: Number(ctx[1]) };
    if (entry.action === 2) compute.push(entry);
    else others.push(entry);
  }
  compute.sort(function (a, b) {
    var am = Date.parse(a.resetsAt || "");
    var bm = Date.parse(b.resetsAt || "");
    return (isFinite(am) ? am : 0) - (isFinite(bm) ? bm : 0);
  });
  if (compute.length >= 2) {
    pushProduct(products, "Current Window", compute[0].pct, compute[0].resetsAt, 5 * 60 * 60 * 1000);
    var weekly = compute[compute.length - 1];
    pushProduct(products, "Weekly", weekly.pct, weekly.resetsAt, 7 * 24 * 60 * 60 * 1000);
  } else if (compute.length === 1) {
    var only = compute[0];
    var dist = only.resetsAt ? Date.parse(only.resetsAt) - now : 0;
    if (dist > 6 * 60 * 60 * 1000) pushProduct(products, "Weekly", only.pct, only.resetsAt, 7 * 24 * 60 * 60 * 1000);
    else pushProduct(products, "Current Window", only.pct, only.resetsAt, 5 * 60 * 60 * 1000);
  }
  if (!products.length && others.length) {
    var best = others[0];
    for (var j = 1; j < others.length; j++) if (others[j].pct > best.pct) best = others[j];
    pushProduct(products, "Usage", best.pct, best.resetsAt, null);
  }
  return products;
}

function parseGeminiRpc(text, now) {
  var legacy = [];
  var quotaRows = [];
  var clock = now == null ? Date.now() : now;
  var cleaned = String(text || "").replace(/^\)\]\}'\s*/, "");
  var lines = cleaned.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.charAt(0) !== "[") continue;
    var frame;
    try {
      frame = JSON.parse(line);
    } catch (err) {
      continue;
    }
    if (!Array.isArray(frame)) continue;
    for (var j = 0; j < frame.length; j++) {
      var entry = frame[j];
      if (!Array.isArray(entry) || entry[0] !== "wrb.fr" || typeof entry[2] !== "string") continue;
      var payload;
      try {
        payload = JSON.parse(entry[2]);
      } catch (err) {
        continue;
      }
      if (entry[1] === "qpEbW") {
        var list = payload && Array.isArray(payload[0]) ? payload[0] : [];
        for (var q = 0; q < list.length; q++) quotaRows.push(list[q]);
        continue;
      }
      if (entry[1] !== "jSf9Qc") continue;
      var rows = payload && Array.isArray(payload[1]) ? payload[1] : [];
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        if (!Array.isArray(row) || !isFinite(Number(row[1]))) continue;
        var ratio = Number(row[1]);
        var pct = ratio >= 0 && ratio <= 1 ? normalizePercent(ratio * 100, false) : normalizePercent(ratio, false);
        var type = Number(row[2]) || (r === 0 ? 1 : 2);
        var label = type === 2 ? "Weekly" : "Current Window";
        pushProduct(legacy, label, pct, geminiStamp(row[3]), type === 2 ? 7 * 24 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000);
      }
    }
  }
  var fromQuota = parseGeminiQuotaRows(quotaRows, clock);
  if (fromQuota.length) return fromQuota;
  return legacy;
}

function pushLabeledPercents(products, visible, clock) {
  var patterns = [
    /(current(?:\s+usage|\s+window|\s+limit)?|weekly(?:\s+limit)?|5-hour(?:\s+limit)?|5 hour)[^%]{0,80}?(\d+(?:\.\d+)?)\s*%/gi,
    /(\d+(?:\.\d+)?)\s*%[^A-Za-z%]{0,40}?(current(?:\s+usage|\s+window|\s+limit)?|weekly(?:\s+limit)?|5-hour(?:\s+limit)?|5 hour)/gi,
    /gxu-(currently|weekly)[^%]{0,400}?(\d+(?:\.\d+)?)\s*%/gi,
  ];
  for (var p = 0; p < patterns.length; p++) {
    var match;
    var re = patterns[p];
    while ((match = re.exec(visible))) {
      var labelWord = /week/i.test(match[1]) || /week/i.test(match[2]) ? "Weekly" : "Current Window";
      var raw = /%/.test(match[0]) ? (/^\d/.test(match[1]) ? match[1] : match[2]) : match[2];
      if (p === 1) raw = match[1];
      if (p === 0 || p === 2) raw = match[2];
      var value = normalizePercent(Number(raw), false);
      var around = visible.slice(Math.max(0, match.index - 40), Math.min(visible.length, match.index + 120));
      pushProduct(products, labelWord, value, parseRelativeReset(around, clock), labelWord === "Weekly" ? 7 * 24 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000);
    }
  }
}
function parseGeminiSource(input, now) {
  var text = String(input || "");
  var clock = now == null ? Date.now() : now;
  if (/accounts\.google\.com\/|ServiceLogin/i.test(text) && !/%\s*used|usedPercent|usagePercent|remainingFraction|jSf9Qc/i.test(text)) {
    return { signedOut: true, percent: null, resetsAt: null, periodMs: null, products: [] };
  }
  var products = parseGeminiRpc(text, clock);
  if (!products.length) {
  var jsonRe = /"(usedPercent|usagePercent|percentUsed)"\s*:\s*(-?\d+(?:\.\d+)?)/g;
  var match;
  while ((match = jsonRe.exec(text))) {
    var pct = normalizePercent(Number(match[2]), false);
    var ctx = text.slice(Math.max(0, match.index - 160), match.index + match[0].length);
    var label = labelFromContext(ctx);
    var after = text.slice(match.index, Math.min(text.length, match.index + 180));
    pushProduct(products, label, pct, parseRelativeReset(after, clock), periodMsForLabel(label));
  }
  var fracRe = /"remainingFraction"\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?)/g;
  while ((match = fracRe.exec(text))) {
    var around = text.slice(Math.max(0, match.index - 200), Math.min(text.length, match.index + 200));
    if (!/quota|usage|limit/i.test(around)) continue;
    var used = normalizePercent((1 - Number(match[1])) * 100, false);
    var fracLabel = labelFromContext(around);
    pushProduct(products, fracLabel, used, parseRelativeReset(around, clock), periodMsForLabel(fracLabel));
  }
  var usedRe = /(\d+(?:\.\d+)?)\s*%\s*used/gi;
  var visible = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/data-test-id="([^"]+)"/gi, " $1 ")
    .replace(/aria-valuenow="(\d+(?:\.\d+)?)"/gi, " $1% ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
  while ((match = usedRe.exec(visible))) {
    var value = normalizePercent(Number(match[1]), false);
    var before = visible.slice(Math.max(0, match.index - 80), match.index);
    var afterText = visible.slice(match.index, Math.min(visible.length, match.index + 80));
    var textLabel = labelFromContext(before);
    pushProduct(products, textLabel, value, parseRelativeReset(afterText, clock), periodMsForLabel(textLabel));
  }
  pushLabeledPercents(products, visible, clock);
  }
  if (!products.length) return { signedOut: false, percent: null, resetsAt: null, periodMs: null, products: [] };
  var headline = products[0];
  for (var i = 1; i < products.length; i++) {
    if (products[i].percent > headline.percent) headline = products[i];
  }
  return {
    signedOut: false,
    percent: headline.percent,
    resetsAt: headline.resetsAt,
    periodMs: headline.periodMs,
    products: products.map(function (row) {
      return { name: row.name, percent: row.percent };
    }),
  };
}

function claudeWindowLabel(key) {
  var name = String(key || "").replace(/[_-]+/g, " ").trim();
  if (/five.?hour|5h|session/i.test(name)) return "5-Hour Window";
  if (/seven.?day|7d|weekly/i.test(name) && /opus/i.test(name)) return "Weekly Opus";
  if (/seven.?day|7d|weekly/i.test(name) && /sonnet/i.test(name)) return "Weekly Sonnet";
  if (/seven.?day|7d|weekly/i.test(name) && /haiku/i.test(name)) return "Weekly Haiku";
  if (/seven.?day|7d|weekly/i.test(name)) return "Weekly Window";
  if (/extra|overage|credit/i.test(name)) return "Extra Usage";
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Window";
}

function readClaudeBucket(bucket, fallbackName) {
  var row = asObject(bucket);
  if (!row) return null;
  var raw = firstNumber(row, ["utilization", "percent", "used_percent", "usedPercent"]);
  if (raw == null) return null;
  var percent = normalizePercent(raw, raw > 0 && raw <= 1);
  if (percent == null) return null;
  var resetsAt = parseTime(row.resets_at || row.resetsAt || row.reset_at || row.resetAt);
  var name = fallbackName || claudeWindowLabel(row.kind || row.name || row.label || "");
  return { name: name, percent: percent, resetsAt: resetsAt };
}

function parseClaudeUsage(input, now) {
  var data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch (err) {
      return null;
    }
  }
  data = asObject(data);
  if (!data) return null;
  var windows = [];
  var known = [
    ["five_hour", "5-Hour Window"],
    ["fiveHour", "5-Hour Window"],
    ["seven_day", "Weekly Window"],
    ["sevenDay", "Weekly Window"],
    ["seven_day_opus", "Weekly Opus"],
    ["seven_day_sonnet", "Weekly Sonnet"],
    ["seven_day_haiku", "Weekly Haiku"],
    ["extra_usage", "Extra Usage"],
    ["overage", "Extra Usage"],
  ];
  for (var i = 0; i < known.length; i++) {
    var bucket = readClaudeBucket(data[known[i][0]], known[i][1]);
    if (bucket) windows.push(bucket);
  }
  var limits = data.limits || data.raw_limits || data.rawLimits;
  if (Array.isArray(limits)) {
    for (var j = 0; j < limits.length; j++) {
      var item = asObject(limits[j]);
      if (!item) continue;
      var label = claudeWindowLabel(item.kind || item.name || item.scope || "");
      var fromLimit = readClaudeBucket(item, label);
      if (fromLimit && !windows.some(function (existing) { return existing.name === fromLimit.name; })) {
        windows.push(fromLimit);
      }
    }
  }
  if (!windows.length) {
    var plan = data.plan || data.plan_type || data.planType || "";
    var freeish = !plan || /free/i.test(plan);
    return {
      percent: null,
      resetsAt: null,
      periodMs: null,
      products: [],
      plan: plan,
      note: freeish ? "Free plan: Claude does not expose usage numbers" : "Signed in, usage not exposed",
    };
  }
  var headline = windows[0];
  for (var k = 1; k < windows.length; k++) {
    if (windows[k].percent > headline.percent) headline = windows[k];
  }
  var periodMs = null;
  if (/5-Hour/i.test(headline.name)) periodMs = 5 * 60 * 60 * 1000;
  else if (/Weekly/i.test(headline.name)) periodMs = 7 * 24 * 60 * 60 * 1000;
  return {
    percent: headline.percent,
    resetsAt: headline.resetsAt,
    periodMs: periodMs,
    products: windows.map(function (row) { return { name: row.name, percent: row.percent }; }),
    plan: data.plan || data.plan_type || data.planType || "",
  };
}
