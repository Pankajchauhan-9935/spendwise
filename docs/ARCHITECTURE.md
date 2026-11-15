# Architecture

## The big picture
```
Browser                                      Flask server
┌───────────────────────────────┐            ┌──────────────────┐
│ HTML + CSS  (rendered pages)  │ ◄───GET──── │ app.py           │
│ JavaScript                    │            │  routes → render │
│  ├ auth.js     → localStorage │            │  templates       │
│  ├ storage.js  → IndexedDB    │            │  + static files  │
│  └ page scripts               │            └──────────────────┘
└───────────────────────────────┘     (no personal data ever travels this way)
```

## How Flask works here
`app.py` has one route per page (`/`, `/login`, `/register`, `/dashboard`, `/expenses`) and a 404 handler. Each route just calls `render_template(...)`. All routes are `GET` only, there are no forms posting to Flask, no REST API, no sessions and no database. A small `after_request` hook adds security headers, including a Content-Security-Policy that only allows scripts and styles from the same origin (so the page cannot call other sites).

Flask templates (`templates/`) share a layout (`base.html`: navigation, toast area, script tags). The expense categories live in one Python list in `app.py` and are rendered into the dropdowns with Jinja.

## How HTML, CSS and JavaScript interact
- **HTML** (from templates) provides the structure and empty containers (e.g. `#recent-list`).
- **CSS** (`public/css/style.css`) styles everything; the layout switches to a mobile menu and stacked cards on small screens.
- **JavaScript** fills the containers with data from the browser's storage. User text is always inserted with `textContent`, never `innerHTML`, so an expense called `<script>` is displayed as text.

Script load order (all `defer`): `auth.js` → `storage.js` → `script.js` → the page script. `script.js` waits for `DOMContentLoaded`, checks the session, then calls the page script's `SW.onReady(...)` callback.

| File | Job |
|---|---|
| `auth.js` | register, login, hashing, session, lockout (localStorage) |
| `storage.js` | IndexedDB access and expense validation |
| `script.js` | session guard, navigation, toasts, formatting helpers |
| `auth-pages.js` | login and register forms |
| `dashboard.js` | dashboard calculations and rendering |
| `expenses.js` | expense form, list, filters, CSV |

## localStorage and IndexedDB
- **localStorage**: a small key/value store that survives browser restarts. Used for accounts and the session (`spendwise.accounts`, `spendwise.session`).
- **IndexedDB**: a larger, structured database inside the browser. Used for expenses and budgets, accessed asynchronously with promises.
Details of the stored fields: [DATA_STORAGE.md](DATA_STORAGE.md).

## Information flow
1. The browser requests `/expenses`; Flask returns HTML (no user data inside).
2. `script.js` calls `Auth.checkSession()`. No valid session → redirect to `/login`.
3. `expenses.js` calls `ExpenseDB.listExpenses(user.id)` and renders the rows.
4. Adding an expense: validate in JS → `ExpenseDB.addExpense(user.id, data)` → re-read list → re-render. The server is not involved.

## How accounts stay isolated
Each account has a random `id`. Every expense record stores `userId`, and the budget record is keyed by `userId`. All storage functions require the `userId`, which comes from the *validated session* (`SW.requireUser()` re-checks expiry on every operation), and reads use the `userId` index. Update and delete check that the record's `userId` matches before touching it. On logout the session is removed and the page content cleared; logging into another account loads only that account's records.
