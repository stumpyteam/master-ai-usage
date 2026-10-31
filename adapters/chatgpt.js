var AIAdapters = globalThis.AIAdapters || (globalThis.AIAdapters = {});

function interpretChatSession(session, usageStatus, usageJson) {
  if (!session || session.error) return { kind: "transient", note: "ChatGPT session needs a reload" };
  if (!session.accessToken && !session.user) return { kind: "signed-out" };
  if (!session.accessToken) return { kind: "reading", signedIn: true, percent: null, resetsAt: null, periodMs: null, products: [], note: "Signed in, usage not exposed" };
  if (usageStatus === 401 || usageStatus === 403) return { kind: "signed-out" };
  if (usageStatus && usageStatus >= 400) {
    return { kind: "reading", signedIn: true, percent: null, resetsAt: null, periodMs: null, products: [], note: "Signed in, usage not exposed" };
  }
  var parsed = parseChatGptUsage(usageJson, Date.now());
  if (!parsed || parsed.percent == null) {
    return {
      kind: "reading",
      signedIn: true,
      percent: null,
      resetsAt: null,
      periodMs: null,
      products: [],
      note: "Signed in, usage not exposed",
      plan: parsed && parsed.plan ? parsed.plan : "",
      tokenNote: parsed && parsed.tokenNote ? parsed.tokenNote : "",
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
    tokenNote: parsed.tokenNote || "",
  };
}

async function fetchChatGptDirect() {
  var sessionRes = await fetch("https://chatgpt.com/api/auth/session", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (sessionRes.status === 401 || sessionRes.status === 403) return { kind: "signed-out" };
  if (!sessionRes.ok) return { kind: "transient", note: "Could not reach ChatGPT" };
  var session = await sessionRes.json();
  if (!session || session.error) return { kind: "transient", note: "ChatGPT session needs a reload" };
  if (!session.accessToken && !session.user) return { kind: "signed-out" };
  if (!session.accessToken) return interpretChatSession(session, 0, null);
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
  return interpretChatSession(session, usageRes.status, usageJson);
}

AIAdapters.chatgpt = {
  id: "chatgpt",
  label: "ChatGPT",
  match: "https://chatgpt.com/*",
  async pull() {
    try {
      var fromTab = await askTab(this.match, this.id);
      if (fromTab && fromTab.kind === "signed-out") return fromTab;
      if (fromTab && fromTab.kind === "reading") return fromTab;
      if (fromTab && fromTab.session && !fromTab.error) return interpretChatSession(fromTab.session, fromTab.usageStatus, fromTab.usageJson);
      return await fetchChatGptDirect();
    } catch (err) {
      return { kind: "transient", note: "Could not reach ChatGPT" };
    }
  },
  ingest(message) {
    if (message.status === 401 || message.status === 403) return { kind: "signed-out" };
    if (!message.body) return null;
    var parsed = parseChatGptUsage(message.body, Date.now());
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
      tokenNote: parsed.tokenNote || "",
    };
  },
};
