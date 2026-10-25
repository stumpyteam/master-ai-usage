function applyTheme(theme) {
  var choice = theme || "auto";
  var resolved = choice;
  if (choice === "auto") {
    var dark = false;
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (err) {
      dark = true;
    }
    resolved = dark ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme-choice", choice);
  document.documentElement.setAttribute("data-theme", resolved);
}

function watchTheme() {
  if (watchTheme.armed) return;
  watchTheme.armed = true;
  var mq;
  try {
    mq = window.matchMedia("(prefers-color-scheme: dark)");
  } catch (err) {
    return;
  }
  var onChange = function () {
    if (document.documentElement.getAttribute("data-theme-choice") === "auto") applyTheme("auto");
  };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
}
