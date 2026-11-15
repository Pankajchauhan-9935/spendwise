/*
 * Shared UI code for every page: session guard, navigation, toasts, formatting.
 * Page scripts call SW.onReady(callback); the callback runs only after a valid
 * session has been confirmed (or immediately on public pages).
 */
(function (global) {
  "use strict";

  const FLASH_KEY = "spendwise.flash";
  const SAFE_NEXT = ["/dashboard", "/expenses"];
  const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const readyCallbacks = [];
  let currentUser = null;

  // ---------- small helpers ----------
  // Build DOM safely: text is always set with textContent, never innerHTML.
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k === "dataset") Object.assign(node.dataset, attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
  }

  function formatINR(value) { return rupees.format(value); }

  function formatDate(iso) {
    const p = iso.split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  function toast(message, type) {
    const box = document.getElementById("toasts");
    if (!box) return;
    const node = el("div", { class: "toast " + (type || "success"), role: type === "error" ? "alert" : "status" }, [
      el("span", { text: message }),
      el("button", { type: "button", class: "close", "aria-label": "Dismiss", text: "×" })
    ]);
    const remove = () => node.remove();
    node.querySelector(".close").addEventListener("click", remove);
    box.appendChild(node);
    setTimeout(remove, type === "error" ? 7000 : 4000);
  }

  // A message to show on the next page (e.g. after logging out).
  function flashNext(message, type) {
    try { sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message: message, type: type || "success" })); } catch (e) { /* ignore */ }
  }

  function showFlash() {
    try {
      const raw = sessionStorage.getItem(FLASH_KEY);
      if (!raw) return;
      sessionStorage.removeItem(FLASH_KEY);
      const f = JSON.parse(raw);
      toast(f.message, f.type);
    } catch (e) { /* ignore */ }
  }

  function safeNext(value) { return SAFE_NEXT.indexOf(value) !== -1 ? value : "/dashboard"; }

  // ---------- session guard ----------
  function redirectToLogin(reason) {
    const next = location.pathname;
    location.replace("/login?reason=" + encodeURIComponent(reason) + "&next=" + encodeURIComponent(next));
  }

  // Returns the validated user for data operations; redirects if the session ended.
  function requireUser() {
    const result = Auth.checkSession();
    if (result.user) { currentUser = result.user; return result.user; }
    currentUser = null;
    redirectToLogin(result.reason === "expired" ? "expired" : "required");
    throw new Error("Not signed in.");
  }

  function applyAuthState(user) {
    document.querySelectorAll("[data-show]").forEach((node) => {
      node.hidden = (node.dataset.show === "auth") !== !!user;
    });
    if (user) {
      const name = document.getElementById("user-name");
      const avatar = document.getElementById("user-avatar");
      if (name) name.textContent = user.username;
      if (avatar) avatar.textContent = user.username.charAt(0).toUpperCase();
    }
    const page = document.body.dataset.page;
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === page) a.setAttribute("aria-current", "page");
    });
  }

  // Wipe everything user-specific from the page (used when the session ends).
  function clearDisplayedData() {
    document.querySelectorAll("main").forEach((m) => { m.hidden = true; m.textContent = ""; });
  }

  function logout() {
    Auth.logout();
    clearDisplayedData();
    flashNext("You have been logged out.", "success");
    location.replace("/login");
  }

  function startSessionWatch(isProtected) {
    const check = () => {
      const r = Auth.checkSession();
      if (isProtected && !r.user) {
        clearDisplayedData();
        redirectToLogin(r.reason === "expired" ? "expired" : "required");
      }
    };
    setInterval(check, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    // Logged out (or logged in as someone else) in another tab.
    global.addEventListener("storage", (e) => {
      if (e.key === "spendwise.session" || e.key === null) {
        if (isProtected) check();
        else location.reload();
      }
    });
  }

  function setupNav() {
    const toggle = document.getElementById("nav-toggle");
    const nav = document.getElementById("main-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);
  }

  function boot() {
    const isProtected = document.body.hasAttribute("data-protected");
    setupNav();
    const result = Auth.checkSession();
    currentUser = result.user || null;
    if (isProtected && !currentUser) {
      redirectToLogin(result.reason === "expired" ? "expired" : "required");
      return;
    }
    applyAuthState(currentUser);
    document.body.classList.add("ready");
    showFlash();
    startSessionWatch(isProtected);
    readyCallbacks.forEach((cb) => {
      Promise.resolve().then(() => cb(currentUser)).catch((err) => {
        if (err && err.message === "Not signed in.") return;
        console.error(err);
        toast("Something went wrong: " + (err && err.message ? err.message : err), "error");
      });
    });
  }

  document.addEventListener("DOMContentLoaded", boot);

  global.SW = {
    el, formatINR, formatDate, toast, flashNext, safeNext, requireUser, logout,
    onReady: (cb) => readyCallbacks.push(cb)
  };
})(window);
