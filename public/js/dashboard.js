/* Dashboard: monthly summary, budget, category bars, 6-month trend, recent expenses. */
(function () {
  "use strict";
  const { el, formatINR, formatDate, toast } = SW;
  const $ = (id) => document.getElementById(id);

  function monthKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }

  function compact(n) {
    if (n >= 10000000) return "₹" + +(n / 10000000).toFixed(1) + "Cr";
    if (n >= 100000) return "₹" + +(n / 100000).toFixed(1) + "L";
    if (n >= 1000) return "₹" + +(n / 1000).toFixed(1) + "k";
    return n > 0 ? "₹" + Math.round(n) : "";
  }

  // Pure calculation: everything the dashboard shows, from the expense list.
  function buildSummary(expenses, budget, now) {
    const thisMonth = monthKey(now);
    const monthItems = expenses.filter((e) => e.date.startsWith(thisMonth));
    const monthTotal = monthItems.reduce((s, e) => s + e.amount, 0);

    const byCat = {};
    monthItems.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    const catRows = Object.keys(byCat).map((c) => [c, byCat[c]]).sort((a, b) => b[1] - a[1]);

    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      trend.push({ label: d.toLocaleDateString("en-IN", { month: "short" }),
        total: expenses.filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.amount, 0) });
    }
    const recent = expenses.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt)).slice(0, 5);
    return {
      monthTotal, monthCount: monthItems.length, topCategory: catRows.length ? catRows[0][0] : null,
      budget, budgetPct: budget ? Math.min(100, Math.round(monthTotal / budget * 100)) : 0,
      remaining: budget - monthTotal, over: budget > 0 && monthTotal > budget,
      catRows, trend, trendMax: Math.max(1, ...trend.map((t) => t.total)), recent,
      allTotal: expenses.reduce((s, e) => s + e.amount, 0)
    };
  }

  function render(s, now) {
    $("month-label").textContent = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    $("stat-month-total").textContent = formatINR(s.monthTotal);
    $("stat-month-count").textContent = String(s.monthCount);
    $("stat-top").textContent = s.topCategory || "–";
    $("stat-all").textContent = formatINR(s.allTotal);

    // Budget
    const progress = $("budget-progress");
    $("budget-empty").hidden = !!s.budget;
    progress.hidden = !s.budget;
    const alertBox = $("budget-alert");
    alertBox.hidden = true;
    if (s.budget) {
      const bar = progress.querySelector(".progress");
      bar.firstElementChild.style.width = s.budgetPct + "%";
      bar.setAttribute("aria-valuenow", String(s.budgetPct));
      bar.classList.toggle("over", s.over);
      bar.classList.toggle("warn", !s.over && s.budgetPct >= 80);
      const text = $("budget-text");
      text.textContent = "";
      text.append(formatINR(s.monthTotal) + " of " + formatINR(s.budget) + " used (" + s.budgetPct + "%) · ");
      text.appendChild(el("strong", { class: s.over ? "danger-text" : "", text: s.over ? formatINR(-s.remaining) + " over budget" : formatINR(s.remaining) + " left" }));
      if (s.over) {
        alertBox.textContent = "Over budget: you have spent " + formatINR(-s.remaining) + " more than your monthly budget of " + formatINR(s.budget) + ".";
        alertBox.hidden = false;
      }
    }

    // Category bars
    const cats = $("category-bars");
    cats.textContent = "";
    if (!s.catRows.length) cats.appendChild(el("div", { class: "empty small" }, [el("p", { text: "No spending recorded this month." })]));
    s.catRows.forEach((row) => {
      const pct = s.monthTotal ? Math.round(row[1] / s.monthTotal * 100) : 0;
      const fill = el("div");
      fill.style.width = pct + "%";
      cats.appendChild(el("div", { class: "bar-row" }, [
        el("span", { text: row[0] }), el("div", { class: "bar", title: pct + "%" }, [fill]), el("em", { text: formatINR(row[1]) })]));
    });

    // 6-month trend
    const chart = $("trend-chart");
    chart.textContent = "";
    s.trend.forEach((t) => {
      const bar = el("div", { class: "col-bar" });
      bar.style.height = Math.round(t.total / s.trendMax * 100) + "%";
      chart.appendChild(el("div", { class: "col", title: t.label + ": " + formatINR(t.total) }, [
        el("small", { class: "col-value", text: compact(t.total) }), bar, el("span", { text: t.label })]));
    });

    // Recent expenses
    const recent = $("recent-list");
    recent.textContent = "";
    if (!s.recent.length) {
      const btn = el("button", { type: "button", class: "btn", id: "sample-btn", text: "Load sample data" });
      recent.appendChild(el("div", { class: "empty small" }, [
        el("p", { text: "No expenses yet. Add your first one, or try the app with sample data." }),
        el("div", { class: "actions center-actions" }, [el("a", { class: "btn primary", href: "/expenses", text: "Add an expense" }), btn])]));
      btn.addEventListener("click", loadSample);
    } else {
      const tbody = el("tbody");
      s.recent.forEach((x) => tbody.appendChild(el("tr", {}, [
        el("td", { text: formatDate(x.date) }), el("td", { text: x.title }),
        el("td", {}, [el("span", { class: "tag", text: x.category })]), el("td", { class: "num", text: formatINR(x.amount) })])));
      recent.appendChild(el("div", { class: "table-wrap" }, [el("table", { class: "plain" }, [tbody])]));
    }
  }

  async function refresh() {
    const user = SW.requireUser();
    const [expenses, budget] = await Promise.all([ExpenseDB.listExpenses(user.id), ExpenseDB.getBudget(user.id)]);
    const now = new Date();
    render(buildSummary(expenses, budget, now), now);
    const input = $("budget-input");
    if (document.activeElement !== input) input.value = budget ? String(budget) : "";
    $("loading").hidden = true;
    $("dashboard-content").hidden = false;
  }

  async function loadSample() {
    const user = SW.requireUser();
    const n = await ExpenseDB.addSampleData(user.id);
    toast("Added " + n + " sample expenses.");
    await refresh();
  }

  SW.onReady(function () {
    $("budget-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const user = SW.requireUser();
        const raw = $("budget-input").value.trim();
        const amount = raw === "" ? NaN : Number(raw);
        if (!isFinite(amount) || amount < 0 || amount > ExpenseDB.MAX_AMOUNT) {
          return toast("Budget must be a number between 0 and 1,00,00,000.", "error");
        }
        await ExpenseDB.setBudget(user.id, Math.round(amount * 100) / 100);
        toast(amount ? "Monthly budget saved." : "Monthly budget cleared.");
        await refresh();
      } catch (err) {
        if (err.message !== "Not signed in.") toast(err.message, "error");
      }
    });
    return refresh();
  });
})();
