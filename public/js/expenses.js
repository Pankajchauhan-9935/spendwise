/* Expenses page: add, edit, delete, search, filter, sort and CSV export. */
(function () {
  "use strict";
  const { el, formatINR, formatDate, toast } = SW;
  const $ = (id) => document.getElementById(id);

  const categories = Array.from($("f-category").options).map((o) => o.value);
  let allExpenses = [];
  let editingId = null;

  // ---------- filtering and sorting ----------
  function readFilters() {
    return { q: $("q").value.trim().toLowerCase(), category: $("category").value,
      start: $("start").value, end: $("end").value, sort: $("sort").value };
  }

  function applyFilters(items, f) {
    const out = items.filter((e) =>
      (!f.q || e.title.toLowerCase().includes(f.q) || (e.note || "").toLowerCase().includes(f.q)) &&
      (!f.category || e.category === f.category) &&
      (!f.start || e.date >= f.start) &&
      (!f.end || e.date <= f.end));
    const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt);
    const sorters = {
      newest: (a, b) => byDate(b, a), oldest: byDate,
      highest: (a, b) => b.amount - a.amount, lowest: (a, b) => a.amount - b.amount };
    return out.sort(sorters[f.sort] || sorters.newest);
  }

  function filtersActive(f) { return !!(f.q || f.category || f.start || f.end); }

  // ---------- rendering ----------
  function render() {
    const f = readFilters();
    const err = $("filter-error");
    if (f.start && f.end && f.start > f.end) {
      err.textContent = "The 'from' date must be on or before the 'to' date.";
      err.hidden = false;
      return;
    }
    err.hidden = true;

    const items = applyFilters(allExpenses.slice(), f);
    const empty = $("empty-state");
    const area = $("list-area");
    $("loading").hidden = true;

    if (!items.length) {
      area.hidden = true;
      empty.hidden = false;
      empty.textContent = "";
      if (!allExpenses.length) {
        const btn = el("button", { type: "button", class: "btn", text: "Load sample data" });
        btn.addEventListener("click", loadSample);
        empty.append(el("h3", { text: "No expenses yet" }),
          el("p", { text: "Add your first expense above, or try the app with sample data." }), btn);
      } else {
        empty.append(el("h3", { text: "No expenses match" }),
          el("p", { text: "Try different search words or reset the filters." }));
      }
      return;
    }
    empty.hidden = true;
    area.hidden = false;
    const total = items.reduce((s, e) => s + e.amount, 0);
    $("result-summary").textContent = items.length + " result" + (items.length === 1 ? "" : "s") + " · " + formatINR(total) +
      (filtersActive(f) ? " (filtered)" : "");

    const tbody = $("expense-rows");
    tbody.textContent = "";
    items.forEach((x) => {
      const editBtn = el("button", { type: "button", class: "link", text: "Edit", "aria-label": "Edit " + x.title });
      const delBtn = el("button", { type: "button", class: "link danger", text: "Delete", "aria-label": "Delete " + x.title });
      editBtn.addEventListener("click", () => startEdit(x));
      delBtn.addEventListener("click", () => removeExpense(x));
      const titleCell = el("td", { dataset: { label: "Title" } }, [x.title]);
      if (x.note) titleCell.appendChild(el("small", { text: x.note }));
      tbody.appendChild(el("tr", {}, [
        el("td", { text: formatDate(x.date), dataset: { label: "Date" } }),
        titleCell,
        el("td", { dataset: { label: "Category" } }, [el("span", { class: "tag", text: x.category })]),
        el("td", { class: "num", text: formatINR(x.amount), dataset: { label: "Amount" } }),
        el("td", { class: "row-actions" }, [editBtn, delBtn])]));
    });
  }

  async function reload() {
    const user = SW.requireUser();
    allExpenses = await ExpenseDB.listExpenses(user.id);
    render();
  }

  // ---------- form: add / edit ----------
  function showFormError(message) { const b = $("form-error"); b.textContent = message; b.hidden = !message; }

  function resetForm() {
    editingId = null;
    $("expense-form").reset();
    $("f-date").value = ExpenseDB.isoDate(new Date());
    $("f-date").max = $("f-date").value;
    $("form-title").textContent = "Add expense";
    $("form-submit").textContent = "Add expense";
    $("form-cancel").hidden = true;
    showFormError("");
  }

  function startEdit(x) {
    editingId = x.id;
    $("f-title").value = x.title;
    $("f-amount").value = x.amount;
    $("f-category").value = x.category;
    $("f-date").value = x.date;
    $("f-note").value = x.note || "";
    $("form-title").textContent = "Edit expense";
    $("form-submit").textContent = "Save changes";
    $("form-cancel").hidden = false;
    showFormError("");
    $("form-card").scrollIntoView({ behavior: "smooth", block: "start" });
    $("f-title").focus();
  }

  async function submitForm(event) {
    event.preventDefault();
    showFormError("");
    const result = ExpenseDB.validateExpense({
      title: $("f-title").value, amount: $("f-amount").value, category: $("f-category").value,
      date: $("f-date").value, note: $("f-note").value }, categories);
    if (result.error) { showFormError(result.error); return; }
    try {
      const user = SW.requireUser();
      if (editingId) {
        await ExpenseDB.updateExpense(user.id, editingId, result.value);
        toast("Saved changes to “" + result.value.title + "”.");
      } else {
        await ExpenseDB.addExpense(user.id, result.value);
        toast("Added “" + result.value.title + "”.");
      }
      resetForm();
      await reload();
    } catch (err) {
      if (err.message === "Not signed in.") return;
      showFormError(err.message);
      toast(err.message, "error");
    }
  }

  async function removeExpense(x) {
    if (!confirm("Delete “" + x.title + "”? This cannot be undone.")) return;
    try {
      const user = SW.requireUser();
      await ExpenseDB.deleteExpense(user.id, x.id);
      if (editingId === x.id) resetForm();
      toast("Expense deleted.");
      await reload();
    } catch (err) {
      if (err.message !== "Not signed in.") toast(err.message, "error");
    }
  }

  async function loadSample() {
    const user = SW.requireUser();
    const n = await ExpenseDB.addSampleData(user.id);
    toast("Added " + n + " sample expenses.");
    await reload();
  }

  // ---------- CSV export (built in the browser, nothing is uploaded) ----------
  function csvCell(value) {
    let s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function buildCSV(items) {
    const rows = [["Date", "Title", "Category", "Amount", "Note"]];
    items.forEach((e) => rows.push([e.date, e.title, e.category, e.amount.toFixed(2), e.note || ""]));
    return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  function exportCSV() {
    const f = readFilters();
    if (f.start && f.end && f.start > f.end) return toast("Fix the date range before exporting.", "error");
    const items = applyFilters(allExpenses.slice(), f);
    if (!items.length) return toast("There is nothing to export.", "error");
    const blob = new Blob(["﻿" + buildCSV(items)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "expenses_" + ExpenseDB.isoDate(new Date()) + ".csv" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Exported " + items.length + " expense" + (items.length === 1 ? "" : "s") + " to CSV.");
  }

  // ---------- wiring ----------
  SW.onReady(function () {
    resetForm();
    $("expense-form").addEventListener("submit", submitForm);
    $("form-cancel").addEventListener("click", resetForm);
    $("filters").addEventListener("submit", (e) => e.preventDefault());
    ["q", "category", "start", "end", "sort"].forEach((id) => {
      $(id).addEventListener(id === "q" ? "input" : "change", render);
    });
    $("reset-filters").addEventListener("click", () => { $("filters").reset(); render(); });
    $("export-btn").addEventListener("click", exportCSV);
    return reload();
  });
})();
