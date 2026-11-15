/*
 * SpendWise browser-local authentication.
 *
 * Everything here runs in the browser. Passwords are never sent anywhere:
 * they are hashed with PBKDF2 (Web Crypto API) and only the salted hash is
 * stored in localStorage. See docs/AUTHENTICATION.md.
 *
 * localStorage keys:
 *   spendwise.accounts  -> { "<lowercase username>": account, ... }
 *   spendwise.session   -> { userId, username, createdAt, expiresAt }
 */
(function (global) {
  "use strict";

  const ACCOUNTS_KEY = "spendwise.accounts";
  const SESSION_KEY = "spendwise.session";

  const PBKDF2_ITERATIONS = 310000;           // OWASP-recommended range for PBKDF2-SHA256
  const SALT_BYTES = 16;
  const HASH_BITS = 256;
  const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // seven days
  const MAX_FAILED_ATTEMPTS = 3;              // consecutive wrong passwords before a lockout
  const BASE_LOCK_MS = 60 * 60 * 1000;        // first lockout: 1 hour, then doubles
  const MAX_LOCK_DOUBLINGS = 30;              // only prevents numeric overflow

  const GENERIC_LOGIN_ERROR = "Incorrect username or password.";

  // ---------- localStorage helpers ----------
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const value = JSON.parse(raw);
      return value && typeof value === "object" ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value)); // may throw if storage is blocked/full
  }

  function storageAvailable() {
    try {
      const k = "spendwise.__test";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function cryptoAvailable() {
    return !!(global.crypto && global.crypto.subtle && global.crypto.getRandomValues);
  }

  // ---------- byte helpers ----------
  function toBase64(bytes) {
    let s = "";
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }

  function fromBase64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Compare two byte arrays without stopping at the first difference.
  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  function newId() {
    if (global.crypto.randomUUID) return global.crypto.randomUUID();
    const b = global.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  // ---------- password hashing ----------
  async function hashPassword(password, saltBytes, iterations) {
    const material = await global.crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await global.crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: iterations },
      material, HASH_BITS);
    return new Uint8Array(bits);
  }

  // ---------- accounts ----------
  function loadAccounts() { return readJSON(ACCOUNTS_KEY, {}); }
  function saveAccounts(accounts) { writeJSON(ACCOUNTS_KEY, accounts); }
  function userKey(username) { return String(username).trim().toLowerCase(); }

  function validateUsername(username) {
    const u = String(username).trim();
    if (u.length < 3 || u.length > 30) return "Username must be 3 to 30 characters long.";
    if (!/^[A-Za-z0-9._-]+$/.test(u)) return "Username can only contain letters, numbers, dot, dash and underscore.";
    return null;
  }

  function validatePassword(password) {
    if (password.length < 8) return "Password must be at least 8 characters long.";
    if (password.length > 200) return "Password is too long (200 characters at most).";
    return null;
  }

  // ---------- session ----------
  function startSession(account) {
    const now = Date.now();
    writeJSON(SESSION_KEY, {
      userId: account.id,
      username: account.username,
      createdAt: now,
      expiresAt: now + SESSION_MS
    });
  }

  /*
   * Check the stored session. Returns { user } when valid, otherwise
   * { reason } where reason is "none", "expired" or "invalid".
   * Expired/invalid sessions are removed. Call this on every protected page
   * load and before data operations; it never trusts the page being "hidden".
   */
  function checkSession() {
    const s = readJSON(SESSION_KEY, null);
    if (!s) return { reason: "none" };
    const now = Date.now();
    const shapeOk = typeof s.userId === "string" && typeof s.username === "string" &&
      typeof s.expiresAt === "number" && isFinite(s.expiresAt);
    if (!shapeOk) { clearSession(); return { reason: "invalid" }; }
    if (s.expiresAt <= now) { clearSession(); return { reason: "expired" }; }
    // A lifetime longer than seven days means the value was tampered with.
    if (s.expiresAt - now > SESSION_MS + 60000) { clearSession(); return { reason: "invalid" }; }
    const account = loadAccounts()[userKey(s.username)];
    if (!account || account.id !== s.userId) { clearSession(); return { reason: "invalid" }; }
    return { user: { id: s.userId, username: account.username, expiresAt: s.expiresAt } };
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- registration ----------
  async function register(username, password) {
    username = String(username).trim();
    const problem = validateUsername(username) || validatePassword(password);
    if (problem) return { ok: false, error: problem };
    if (!storageAvailable()) return { ok: false, error: "Browser storage is unavailable (private mode or blocked). SpendWise needs it to save your account." };
    if (!cryptoAvailable()) return { ok: false, error: "Secure browser features are unavailable. Open SpendWise over https:// or on localhost." };

    if (loadAccounts()[userKey(username)]) {
      return { ok: false, error: "That username is already taken in this browser." };
    }
    const salt = global.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hash = await hashPassword(password, salt, PBKDF2_ITERATIONS);

    const accounts = loadAccounts(); // re-read: another tab may have registered meanwhile
    if (accounts[userKey(username)]) {
      return { ok: false, error: "That username is already taken in this browser." };
    }
    const account = {
      id: newId(),
      username: username,
      createdAt: Date.now(),
      algorithm: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64(salt),
      hash: toBase64(hash),
      failedAttempts: 0,
      lockLevel: 0,
      lockedUntil: 0
    };
    accounts[userKey(username)] = account;
    saveAccounts(accounts);
    startSession(account);
    return { ok: true, user: { id: account.id, username: account.username } };
  }

  // ---------- login + progressive lockout ----------
  function lockDuration(level) {
    return BASE_LOCK_MS * Math.pow(2, Math.min(level - 1, MAX_LOCK_DOUBLINGS)); // 1h, 2h, 4h, 8h, 16h ...
  }

  // Remaining lockout for a username, calculated from timestamps (not timers).
  function getLockStatus(username) {
    const account = loadAccounts()[userKey(username)];
    if (!account) return { locked: false, remainingMs: 0 };
    const remaining = (account.lockedUntil || 0) - Date.now();
    return remaining > 0
      ? { locked: true, remainingMs: remaining, lockedUntil: account.lockedUntil }
      : { locked: false, remainingMs: 0 };
  }

  function lockedResult(remainingMs) {
    return { ok: false, locked: true, remainingMs: remainingMs,
      error: "Too many incorrect attempts. This account is locked for " + formatDuration(remainingMs) + "." };
  }

  async function login(username, password) {
    username = String(username).trim();
    if (!username || !password) return { ok: false, error: "Enter your username and password." };
    if (!storageAvailable()) return { ok: false, error: "Browser storage is unavailable (private mode or blocked)." };
    if (!cryptoAvailable()) return { ok: false, error: "Secure browser features are unavailable. Open SpendWise over https:// or on localhost." };

    const key = userKey(username);
    let account = loadAccounts()[key];

    if (!account) {
      // Spend the same time as a real check so the response time does not reveal
      // whether the username exists, and give the same generic message.
      await hashPassword(password, new Uint8Array(SALT_BYTES), PBKDF2_ITERATIONS);
      return { ok: false, error: GENERIC_LOGIN_ERROR };
    }

    // 1. No attempts at all during an active lockout.
    let lock = getLockStatus(username);
    if (lock.locked) return lockedResult(lock.remainingMs);

    // 2. Verify the password.
    const stored = fromBase64(account.salt);
    const computed = await hashPassword(password, stored, account.iterations || PBKDF2_ITERATIONS);
    const matches = safeEqual(computed, fromBase64(account.hash));

    // 3. Re-read state (another tab may have changed it while we were hashing).
    const accounts = loadAccounts();
    account = accounts[key];
    if (!account) return { ok: false, error: GENERIC_LOGIN_ERROR };
    lock = getLockStatus(username);
    if (lock.locked) return lockedResult(lock.remainingMs);

    if (matches) {
      account.failedAttempts = 0;
      account.lockLevel = 0;
      account.lockedUntil = 0;
      saveAccounts(accounts);
      startSession(account); // new seven-day session
      return { ok: true, user: { id: account.id, username: account.username } };
    }

    account.failedAttempts = (account.failedAttempts || 0) + 1;
    if (account.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      account.lockLevel = (account.lockLevel || 0) + 1;
      account.lockedUntil = Date.now() + lockDuration(account.lockLevel);
      account.failedAttempts = 0; // a fresh set of three attempts after the lock ends
      saveAccounts(accounts);
      return lockedResult(account.lockedUntil - Date.now());
    }
    saveAccounts(accounts);
    const left = MAX_FAILED_ATTEMPTS - account.failedAttempts;
    return { ok: false, attemptsLeft: left,
      error: GENERIC_LOGIN_ERROR + " " + left + (left === 1 ? " attempt" : " attempts") + " left before the account is locked." };
  }

  function logout() { clearSession(); }

  function formatDuration(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts = [];
    if (h) parts.push(h + (h === 1 ? " hour" : " hours"));
    if (m) parts.push(m + (m === 1 ? " minute" : " minutes"));
    if (!h && s) parts.push(s + (s === 1 ? " second" : " seconds"));
    return parts.length ? parts.join(" ") : "0 seconds";
  }

  global.Auth = {
    SESSION_MS, MAX_FAILED_ATTEMPTS, PBKDF2_ITERATIONS,
    register, login, logout, checkSession, getLockStatus, lockDuration,
    validateUsername, validatePassword, formatDuration, storageAvailable, cryptoAvailable
  };
})(window);
