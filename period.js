var WEEK_MS = 7 * 24 * 60 * 60 * 1000;

var SERVICE_ORDER = ["grok", "gemini", "chatgpt", "claude"];

function blankService(id, label) {
  return {
    id: id,
    label: label,
    signedIn: null,
    percent: null,
    resetsAt: null,
    periodMs: id === "grok" ? WEEK_MS : null,
    products: [],
    note: "Checking…",
    periodClosed: false,
    checkedAt: 0,
    lastError: "",
    plan: "",
  };
}

function defaultSnapshot() {
  return {
    theme: "auto",
    services: {
      grok: blankService("grok", "Grok"),
      gemini: blankService("gemini", "Gemini"),
      chatgpt: blankService("chatgpt", "ChatGPT"),
      claude: blankService("claude", "Claude"),
    },
  };
}

function isPeriodClosed(iso, now) {
  if (!iso) return false;
  var t = Date.parse(iso);
  if (!isFinite(t)) return false;
  return t <= now;
}

function rollReset(iso, periodMs, now) {
  var t = Date.parse(iso);
  if (!isFinite(t)) return null;
  if (!(periodMs > 0)) return t > now ? new Date(t).toISOString() : null;
  var guard = 0;
  while (t <= now && guard < 520) {
    t += periodMs;
    guard += 1;
  }
  if (t <= now) return null;
  return new Date(t).toISOString();
}

function displayReset(iso, periodMs, now) {
  if (!iso) return null;
  var t = Date.parse(iso);
  if (!isFinite(t)) return null;
  if (t > now) return new Date(t).toISOString();
  return rollReset(iso, periodMs, now);
}

function closedNote(service) {
  if (service.id === "grok" || service.periodMs === WEEK_MS) return "This week ended. Waiting for the new pool.";
  return "This period ended. Waiting for the new pool.";
}

function decorateService(service, now) {
  var copy = {
    id: service.id,
    label: service.label,
    signedIn: service.signedIn,
    percent: service.percent,
    resetsAt: service.resetsAt,
    periodMs: service.periodMs,
    products: service.products ? service.products.slice() : [],
    note: service.note || "",
    periodClosed: false,
    checkedAt: service.checkedAt || 0,
    lastError: service.lastError || "",
    plan: service.plan || "",
    tokenNote: service.tokenNote || "",
    displayResetsAt: displayReset(service.resetsAt, service.periodMs, now),
  };
  if (service.signedIn === true && isPeriodClosed(service.resetsAt, now)) {
    copy.periodClosed = true;
    copy.percent = null;
    copy.products = [];
    copy.note = closedNote(service);
  }
  return copy;
}

function applyReading(prev, reading, now) {
  if (!reading || reading.kind === "transient") {
    var kept = blankService(prev.id, prev.label);
    kept.signedIn = prev.signedIn;
    kept.percent = prev.percent;
    kept.resetsAt = prev.resetsAt;
    kept.periodMs = prev.periodMs;
    kept.products = prev.products ? prev.products.slice() : [];
    kept.note = prev.note;
    kept.periodClosed = prev.periodClosed;
    kept.checkedAt = now;
    kept.lastError = (reading && reading.note) || "Could not refresh";
    kept.plan = prev.plan || "";
    kept.tokenNote = prev.tokenNote || "";
    if (prev.signedIn == null && prev.percent == null) kept.note = kept.lastError;
    return kept;
  }
  if (reading.kind === "signed-out") {
    return {
      id: prev.id,
      label: prev.label,
      signedIn: false,
      percent: null,
      resetsAt: null,
      periodMs: prev.periodMs,
      products: [],
      note: "Signed out",
      periodClosed: false,
      checkedAt: now,
      lastError: "",
      plan: "",
      tokenNote: "",
    };
  }
  var next = {
    id: prev.id,
    label: prev.label,
    signedIn: true,
    percent: reading.percent == null ? null : reading.percent,
    resetsAt: reading.resetsAt || null,
    periodMs: reading.periodMs != null ? reading.periodMs : prev.periodMs,
    products: reading.products ? reading.products.slice() : [],
    note: reading.note || "",
    periodClosed: false,
    checkedAt: now,
    lastError: "",
    plan: reading.plan || "",
    tokenNote: reading.tokenNote || "",
  };
  if (next.percent == null) {
    next.products = [];
    next.note = "Signed in, usage not exposed";
  }
  if (isPeriodClosed(next.resetsAt, now)) {
    next.periodClosed = true;
    next.percent = null;
    next.products = [];
    next.note = closedNote(next);
  }
  return next;
}

function serviceForUrl(url) {
  var value = String(url || "");
  if (/^https:\/\/([a-z0-9-]+\.)*grok\.com(\/|$)/i.test(value) || /^https:\/\/grok\.x\.com(\/|$)/i.test(value)) return "grok";
  if (/^https:\/\/gemini\.google\.com(\/|$)/i.test(value)) return "gemini";
  if (/^https:\/\/([a-z0-9-]+\.)*chatgpt\.com(\/|$)/i.test(value)) return "chatgpt";
  if (/^https:\/\/([a-z0-9-]+\.)*claude\.ai(\/|$)/i.test(value)) return "claude";
  return null;
}

function toolbarPercent(snapshot, now, site) {
  if (!snapshot || !snapshot.services) return null;
  var forced = site && SERVICE_ORDER.indexOf(site) !== -1 ? site : null;
  var ids = forced ? [forced] : SERVICE_ORDER;
  var best = null;
  for (var i = 0; i < ids.length; i++) {
    var service = snapshot.services[ids[i]];
    if (!service) continue;
    var view = decorateService(service, now);
    if (view.signedIn !== true || view.percent == null) {
      if (forced) return null;
      continue;
    }
    if (forced) return view.percent;
    if (best == null || view.percent > best) best = view.percent;
  }
  return best;
}

function formatWhen(iso) {
  if (!iso) return "";
  var date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch (err) {
    return date.toUTCString();
  }
}

function reapSnapshot(snapshot, now) {
  var changed = false;
  for (var i = 0; i < SERVICE_ORDER.length; i++) {
    var id = SERVICE_ORDER[i];
    var service = snapshot.services[id];
    if (!service) continue;
    var view = decorateService(service, now);
    if (!view.periodClosed) continue;
    if (service.percent != null || (service.products && service.products.length) || service.note !== view.note) {
      service.percent = null;
      service.products = [];
      service.periodClosed = true;
      service.note = view.note;
      changed = true;
    }
  }
  return changed;
}
