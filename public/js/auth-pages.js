/* Login and registration page behaviour. Passwords stay in this browser. */
(function () {
  "use strict";

  const form = document.getElementById("login-form") || document.getElementById("register-form");
  if (!form) return;
  const isLogin = form.id === "login-form";
  const errorBox = document.getElementById("form-error");
  const submitBtn = document.getElementById("submit-btn");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  let lockTimer = null;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.dataset.label = submitBtn.dataset.label || submitBtn.textContent;
    submitBtn.textContent = busy ? "Please wait…" : submitBtn.dataset.label;
  }

  SW.onReady(function (user) {
    // Already logged in? Go straight to the dashboard.
    if (user) { location.replace("/dashboard"); return; }

    if (!Auth.storageAvailable()) showError("Browser storage is unavailable (private mode or blocked). SpendWise needs it to save your account.");
    else if (!Auth.cryptoAvailable()) showError("Secure browser features are unavailable. Open SpendWise over https:// or on localhost.");

    if (isLogin) {
      const reason = new URLSearchParams(location.search).get("reason");
      const notice = document.getElementById("form-notice");
      if (reason === "expired") { notice.textContent = "Your 7-day session has ended. Please log in again."; notice.hidden = false; }
      else if (reason === "required") { notice.textContent = "Please log in to continue."; notice.hidden = false; }
      usernameInput.addEventListener("input", updateLockBanner);
      updateLockBanner();
    }
    usernameInput.focus();
  });

  // ---------- lockout banner with a live countdown (computed from timestamps) ----------
  function updateLockBanner() {
    clearInterval(lockTimer);
    const banner = document.getElementById("lock-banner");
    const render = function () {
      const status = Auth.getLockStatus(usernameInput.value);
      if (!status.locked) {
        banner.hidden = true;
        submitBtn.disabled = false;
        clearInterval(lockTimer);
        return;
      }
      banner.textContent = "Too many incorrect attempts. This account is locked. Try again in " + Auth.formatDuration(status.remainingMs) + ".";
      banner.hidden = false;
      submitBtn.disabled = true;
    };
    render();
    lockTimer = setInterval(render, 1000);
  }

  // ---------- submit ----------
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    showError("");
    const username = usernameInput.value;
    const password = passwordInput.value;

    if (!isLogin) {
      const problem = Auth.validateUsername(username) || Auth.validatePassword(password);
      if (problem) return showError(problem);
      if (password !== document.getElementById("confirm").value) return showError("Passwords do not match.");
    }

    setBusy(true);
    let result;
    try {
      result = isLogin ? await Auth.login(username, password) : await Auth.register(username, password);
    } catch (err) {
      result = { ok: false, error: "Something went wrong: " + (err && err.message ? err.message : err) };
    }
    setBusy(false);

    if (result.ok) {
      SW.flashNext(isLogin ? "Welcome back, " + result.user.username + "!" : "Account created. Welcome to SpendWise!", "success");
      const next = SW.safeNext(new URLSearchParams(location.search).get("next"));
      location.replace(isLogin ? next : "/dashboard");
      return;
    }
    passwordInput.value = "";
    const confirm = document.getElementById("confirm");
    if (confirm) confirm.value = "";
    showError(result.error);
    if (isLogin) updateLockBanner();
    passwordInput.focus();
  });
})();
