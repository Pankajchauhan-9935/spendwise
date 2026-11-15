/*
 * SpendWise expense and budget storage (IndexedDB) plus expense validation.
 *
 * Database "spendwise" (version 1):
 *   expenses  keyPath "id",     index "userId"  -> one record per expense
 *   budgets   keyPath "userId"                  -> one record per account
 *
 * Every record carries the owner's userId and every function below takes a
 * userId, so one account can never read or change another account's data.
 */
(function (global) {
  "use strict";

  const DB_NAME = "spendwise";
  const DB_VERSION = 1;
  const MAX_AMOUNT = 10000000;

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB is not available in this browser."));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("expenses")) {
          db.createObjectStore("expenses", { keyPath: "id" }).createIndex("userId", "userId", { unique: false });
        }
        if (!db.objectStoreNames.contains("budgets")) {
          db.createObjectStore("budgets", { keyPath: "userId" });
        }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error || new Error("Could not open the browser database."));
      req.onblocked = () => reject(new Error("The browser database is blocked by another tab. Close other SpendWise tabs and retry."));
    }).catch((err) => { dbPromise = null; throw err; });
    return dbPromise;
  }

  // Wrap an IDBRequest in a promise.
  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Resolve once the whole transaction has committed.
  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted."));
    });
  }

  function needUser(userId) {
    if (typeof userId !== "string" || !userId) throw new Error("No signed-in user.");
  }

  function newId() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---------- expenses ----------
  async function listExpenses(userId) {
    needUser(userId);
    const db = await openDB();
    const store = db.transaction("expenses", "readonly").objectStore("expenses");
    return wrap(store.index("userId").getAll(userId));
  }

  function toRecord(userId, clean) {
    return { userId: userId, title: clean.title, amount: clean.amount,
      category: clean.category, date: clean.date, note: clean.note };
  }

  async function addExpense(userId, clean) {
    needUser(userId);
    const record = Object.assign({ id: newId(), createdAt: Date.now() }, toRecord(userId, clean));
    const db = await openDB();
    const tx = db.transaction("expenses", "readwrite");
    tx.objectStore("expenses").add(record);
    await done(tx);
    return record;
  }

  async function updateExpense(userId, id, clean) {
    needUser(userId);
    const db = await openDB();
    const tx = db.transaction("expenses", "readwrite");
    const store = tx.objectStore("expenses");
    const existing = await wrap(store.get(id));
    if (!existing || existing.userId !== userId) {
      tx.abort();
      throw new Error("That expense no longer exists.");
    }
    store.put(Object.assign({}, existing, toRecord(userId, clean), { updatedAt: Date.now() }));
    await done(tx);
  }

  async function deleteExpense(userId, id) {
    needUser(userId);
    const db = await openDB();
    const tx = db.transaction("expenses", "readwrite");
    const store = tx.objectStore("expenses");
    const existing = await wrap(store.get(id));
    if (!existing || existing.userId !== userId) {
      tx.abort();
      throw new Error("That expense no longer exists.");
    }
    store.delete(id);
    await done(tx);
  }

  // ---------- budget ----------
  async function getBudget(userId) {
    needUser(userId);
    const db = await openDB();
    const row = await wrap(db.transaction("budgets", "readonly").objectStore("budgets").get(userId));
    return row ? Number(row.monthlyBudget) || 0 : 0;
  }

  async function setBudget(userId, amount) {
    needUser(userId);
    const db = await openDB();
    const tx = db.transaction("budgets", "readwrite");
    tx.objectStore("budgets").put({ userId: userId, monthlyBudget: amount, updatedAt: Date.now() });
    await done(tx);
  }

  // ---------- validation (shared by add and edit) ----------
  function isoDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /*
   * input: { title, amount, category, date, note } as strings from the form.
   * Returns { value } with cleaned data, or { error } with a message.
   */
  function validateExpense(input, categories) {
    const title = String(input.title || "").trim();
    const note = String(input.note || "").trim();
    if (!title || title.length > 80) return { error: "Title is required and must be 80 characters or fewer." };
    const raw = String(input.amount || "").trim();
    const amount = raw === "" ? NaN : Math.round(Number(raw) * 100) / 100;
    if (!isFinite(amount)) return { error: "Amount must be a number." };
    if (!(amount > 0 && amount <= MAX_AMOUNT)) return { error: "Amount must be greater than 0 and at most ₹1,00,00,000." };
    if (categories.indexOf(input.category) === -1) return { error: "Please choose a valid category." };
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input.date || ""));
    const parsed = m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    if (!parsed || isoDate(parsed) !== input.date) return { error: "Please enter a valid date." };
    if (input.date > isoDate(new Date())) return { error: "Date cannot be in the future." };
    if (note.length > 200) return { error: "Note must be 200 characters or fewer." };
    return { value: { title: title, amount: amount, category: input.category, date: input.date, note: note } };
  }

  // ---------- sample data (optional, loaded only when the user clicks the button) ----------
  const SAMPLE = [
    ["Monthly bus pass", 900, "Transport", 2, "Campus to city"],
    ["Mess fees", 3500, "Food", 3, ""],
    ["Python course", 499, "Education", 5, "Udemy sale"],
    ["Movie night", 350, "Entertainment", 6, "With friends"],
    ["Notebook and pens", 220, "Education", 8, ""],
    ["Canteen lunch", 120, "Food", 9, ""],
    ["Mobile recharge", 299, "Bills", 12, "28-day plan"],
    ["Auto rickshaw", 80, "Transport", 14, ""],
    ["Hoodie", 1299, "Shopping", 20, ""],
    ["Pharmacy", 260, "Health", 28, ""],
    ["Wi-Fi bill", 600, "Bills", 40, ""],
    ["Weekend trip", 2400, "Entertainment", 55, "Shimla"],
    ["Groceries", 780, "Food", 75, ""],
    ["Books", 1100, "Education", 100, ""]
  ];

  async function addSampleData(userId) {
    needUser(userId);
    const db = await openDB();
    const tx = db.transaction("expenses", "readwrite");
    const store = tx.objectStore("expenses");
    const now = new Date();
    SAMPLE.forEach((s) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - s[3]);
      store.add({ id: newId(), userId: userId, createdAt: Date.now(), title: s[0], amount: s[1],
        category: s[2], date: isoDate(d), note: s[4] });
    });
    await done(tx);
    return SAMPLE.length;
  }

  global.ExpenseDB = {
    MAX_AMOUNT, isoDate, validateExpense,
    listExpenses, addExpense, updateExpense, deleteExpense,
    getBudget, setBudget, addSampleData
  };
})(window);
