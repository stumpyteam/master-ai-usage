var browser = globalThis.browser || globalThis.chrome;

function askTab(urlPattern, service) {
  return browser.tabs
    .query({ url: urlPattern })
    .then(function (tabs) {
      if (!tabs || !tabs.length) return null;
      var tab = tabs[0];
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].active) tab = tabs[i];
      }
      return browser.tabs.sendMessage(tab.id, { type: "pull", service: service }).catch(function () {
        return null;
      });
    })
    .catch(function () {
      return null;
    });
}

function withTimeout(promise, ms, note) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      resolve({ kind: "transient", note: note || "Timed out" });
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
        resolve({ kind: "transient", note: note || "Could not refresh" });
      },
    );
  });
}
