var AIAdapters = globalThis.AIAdapters || (globalThis.AIAdapters = {});

function interpretClaude(status, payload) {
  if (status === 401 || status === 403) return { kind: "signed-out" };
  if (status == null || status >= 500 || status === 0) return { kind: "transient", note: "Could not reach Claude" };
  if (status >= 400) return { kind: "transient", note: "Claude returned " + status };
  var parsed = typeof parseClaudeUsage === "function" ? parseClaudeUsage(payload, Date.now()) : null;
  if (!parsed || parsed.percent == null) {
    return {
      kind: "reading",
      signedIn: true,
      percent: null,
      resetsAt: null,
      periodMs: null,
      products: [],
      note: (parsed && parsed.note) || "Signed in, usage not exposed",
      plan: parsed && parsed.plan ? parsed.plan : "",
    };
  }
  return {
    kind: "reading",
    signedIn: true,
    percent: parsed.percent,
    resetsAt: parsed.resetsAt,
    periodMs: parsed.periodMs,
    products: parsed.products,
    note: "",
    plan: parsed.plan || "",
  };
}

async function claudeJson(url) {
  var res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: {
      accept: "application/json",
      Origin: "https://claude.ai",
      Referer: "https://claude.ai/",
    },
  });
  var body = null;
  try {
    body = await res.json();
  } catch (err) {
    body = null;
  }
  return { status: res.status, body: body };
}

function claudeOrgId(payload) {
  if (!payload) return "";
  var list = Array.isArray(payload) ? payload : payload.data || payload.organizations || [];
  if (!Array.isArray(list)) return "";
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || typeof row !== "object") continue;
    var id = row.uuid || row.id || row.organization_uuid || "";
    if (typeof id === "string" && /^[0-9a-f-]{16,}$/i.test(id)) return id;
  }
  return "";
}

async function fetchClaudeDirect() {
  var orgs = await claudeJson("https://claude.ai/api/organizations");
  if (orgs.status === 401 || orgs.status === 403) return { kind: "signed-out" };
  if (!orgs.body) return { kind: "transient", note: "Could not reach Claude" };
  var orgId = claudeOrgId(orgs.body);
  if (!orgId) return { kind: "signed-out" };
  var usage = await claudeJson("https://claude.ai/api/organizations/" + orgId + "/usage");
  return interpretClaude(usage.status, usage.body);
}

AIAdapters.claude = {
  id: "claude",
  label: "Claude",
  match: "https://claude.ai/*",
  async pull() {
    try {
      var fromTab = await askTab(this.match, this.id);
      if (fromTab && fromTab.kind === "signed-out") return fromTab;
      if (fromTab && fromTab.kind === "reading") return fromTab;
      if (fromTab && fromTab.usageStatus != null) return interpretClaude(fromTab.usageStatus, fromTab.usageJson || fromTab.body);
      return await fetchClaudeDirect();
    } catch (err) {
      return { kind: "transient", note: "Could not reach Claude" };
    }
  },
  ingest(message) {
    if (message.status === 401 || message.status === 403) return { kind: "signed-out" };
    if (!message.body) return null;
    var parsed = typeof parseClaudeUsage === "function" ? parseClaudeUsage(message.body, Date.now()) : null;
    if (!parsed || parsed.percent == null) return null;
    return {
      kind: "reading",
      signedIn: true,
      percent: parsed.percent,
      resetsAt: parsed.resetsAt,
      periodMs: parsed.periodMs,
      products: parsed.products,
      note: "",
      plan: parsed.plan || "",
    };
  },
};
