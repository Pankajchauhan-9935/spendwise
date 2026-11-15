# Data Storage

## What is stored, and where
| Data | Where |
|---|---|
| Username, account id, creation time | localStorage |
| Password salt and PBKDF2 hash | localStorage |
| Failed-attempt counter, lockout level, lockout time | localStorage |
| Session (user, expiry) | localStorage |
| Expenses | IndexedDB |
| Monthly budgets | IndexedDB |
| One-off notices (e.g. "logged out") | sessionStorage (cleared after display) |
| **Anything on the Flask server** | **nothing** |

## localStorage structure
`spendwise.accounts`
```json
{
  "alice": {
    "id": "b1c2…uuid",
    "username": "Alice",
    "createdAt": 1763200000000,
    "algorithm": "PBKDF2-SHA256",
    "iterations": 310000,
    "salt": "<base64, 16 bytes>",
    "hash": "<base64, 32 bytes>",
    "failedAttempts": 0,
    "lockLevel": 0,
    "lockedUntil": 0
  }
}
```
The key is the lower-cased username.

`spendwise.session`
```json
{ "userId": "b1c2…uuid", "username": "Alice", "createdAt": 1763200000000, "expiresAt": 1763804800000 }
```

## IndexedDB structure
Database `spendwise`, version 1.

| Object store | Key | Index | Record |
|---|---|---|---|
| `expenses` | `id` | `userId` | `{ id, userId, title, amount, category, date, note, createdAt, updatedAt? }` |
| `budgets` | `userId` | – | `{ userId, monthlyBudget, updatedAt }` |

`date` is `YYYY-MM-DD` (local date) and `amount` is a number rounded to 2 decimals.

## Account-specific separation
Every expense carries its owner's `userId`; budgets are keyed by `userId`. Lists are read through the `userId` index, and edit/delete refuse records whose `userId` does not match the signed-in user. Accounts therefore share the same database but never see each other's records. (Anyone with developer-tools access can still inspect everything: this is separation, not secrecy.)

## CSV export
*Download CSV* builds a CSV from the currently filtered list inside the browser and saves it with a normal download. Nothing is uploaded. It is your backup option: there is no import feature yet.

## When browser data is cleared
Clearing "cookies and site data" (or using a private window, or uninstalling the browser) deletes localStorage and IndexedDB for the site: **all accounts and expenses are gone and cannot be recovered**. Export CSV files regularly. Note that data is stored per *origin*: `http://localhost:5000` and your deployed site have separate data, and so do different ports and browsers.

## Why data does not sync across devices
The data lives only in one browser's storage on one device. The server has no database and receives nothing, so there is nothing to sync from. This is deliberate: it keeps your financial data private. To move data, export CSV.
