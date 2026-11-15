# Authentication

All of this runs in the browser (`public/js/auth.js`). The server is never contacted.

## Registration
1. Username (3–30 chars, `A-Z a-z 0-9 . _ -`) and password (8–200 chars) are validated.
2. Usernames are unique case-insensitively within the browser.
3. A random 16-byte **salt** is generated with `crypto.getRandomValues`.
4. The password is hashed (below). Only salt + hash are saved.
5. The account is saved in `localStorage["spendwise.accounts"]` and a session starts.

## Password hashing
- **PBKDF2** with **SHA-256**, **310,000 iterations**, 256-bit output, via `crypto.subtle.deriveBits` (Web Crypto API).
- A **unique random salt** per account, so identical passwords give different hashes.
- Hashes are compared with a **constant-time** byte comparison.
- Passwords are never stored, logged, put in URLs or sent anywhere. The password inputs have no `name` attribute, so even if JavaScript failed, a form submit could not carry them.
- Web Crypto needs a secure context: `https://`, or `http://localhost` / `127.0.0.1`.

## Login
1. If the username is unknown, the same amount of hashing work is done and the generic message "Incorrect username or password." is shown.
2. If the account is locked, the attempt is refused **without checking the password**.
3. Otherwise the password is hashed and compared. On success, counters reset and a new session starts.

## Seven-day session
On login a session is stored in `localStorage["spendwise.session"]`:
`{ userId, username, createdAt, expiresAt }` where `expiresAt = now + 7 days`.

It is checked **in JavaScript on every protected page load, every 30 s, when the tab regains focus, and before each data operation** (not just by hiding the login screen). Expired, malformed, tampered (expiry more than 7 days ahead) or orphaned sessions are deleted and the user is sent to `/login`. Logging in again starts a fresh seven days. Protected page content stays hidden until the session is verified.

## Three incorrect attempts and progressive lockout
Per account, stored in localStorage: `failedAttempts`, `lockLevel`, `lockedUntil` (a timestamp).

| Event | Result |
|---|---|
| Wrong password 1 or 2 | counter increases; message shows attempts left |
| Wrong password 3 | lockout starts, counter resets to 0 |
| Lockout number 1, 2, 3, 4, 5, … | 1 h, 2 h, 4 h, 8 h, 16 h, … (doubling) |
| Correct password | `failedAttempts`, `lockLevel` and `lockedUntil` reset to 0 |

- Remaining time is computed as `lockedUntil − Date.now()`, so it survives page refresh and closing/reopening the browser; the on-screen countdown is only a display refresh.
- The login button is disabled and the remaining time is shown during a lockout.
- After a lockout ends the user gets three new attempts; failing again starts the next, longer lockout.

## Logout
Removes the session from localStorage, clears the page, and goes to `/login`. Logging out in one tab also ends the session in other open tabs. Expense data stays in IndexedDB for the next login.

## Limitations: this is NOT a secure online account system
- It is meant for personal use on one browser and device. It is not enterprise-grade authentication.
- Anyone with access to the browser profile or developer tools can edit or delete localStorage/IndexedDB: reset lockout counters, remove accounts, read all expenses. Lockout and sessions only stop casual access.
- Expenses are not encrypted; a password hash protects the password, not the stored data.
- Clearing browser data deletes accounts and expenses permanently. There is no password recovery.
- Lockout timing depends on the device clock.
