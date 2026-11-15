"""Real-browser tests (Playwright + Chromium) for the JavaScript features.

Optional: needs `pip install playwright` and `playwright install chromium`.
The tests are skipped automatically when Playwright is not installed.
Run:   python -m unittest tests.test_browser -v     (from the project folder)
"""
import csv
import datetime as dt
import io
import json
import logging
import os
import sys
import tempfile
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

from werkzeug.serving import make_server  # noqa: E402
from app import app  # noqa: E402

HOUR = 3600 * 1000
DAY = 24 * HOUR
PW = "correct-horse-battery"


@unittest.skipIf(sync_playwright is None, "playwright is not installed")
class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        logging.getLogger("werkzeug").setLevel(logging.ERROR)
        cls.server = make_server("127.0.0.1", 0, app, threaded=True)
        cls.port = cls.server.server_port
        cls.base = f"http://127.0.0.1:{cls.port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()

    def setUp(self):
        self.context = self.browser.new_context(accept_downloads=True)
        self.page = self.context.new_page()
        self.problems, self.requests = [], []
        self.attach(self.page)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.problems, [], "browser console/page errors")

    def attach(self, page):
        page.on("console", lambda m: self.problems.append(("console", m.text)) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: self.problems.append(("pageerror", str(e))))
        page.on("requestfailed", lambda r: self.problems.append(("requestfailed", r.url)))
        page.on("response", lambda r: self.problems.append(("http", r.url, r.status)) if r.status >= 400 else None)
        page.on("request", lambda r: self.requests.append((r.method, r.url)))
        page.on("dialog", lambda d: d.accept())

    # ---------- helpers ----------
    def go(self, path):
        self.page.goto(self.base + path)
        self.page.wait_for_load_state("networkidle")

    def register(self, user, pw=PW):
        self.go("/register")
        self.page.fill("#username", user)
        self.page.fill("#password", pw)
        self.page.fill("#confirm", pw)
        self.page.click("#submit-btn")
        self.page.wait_for_url("**/dashboard")
        self.page.wait_for_selector("#dashboard-content:not([hidden])")

    def logout(self):
        self.page.click("#logout-btn")
        self.page.wait_for_url("**/login")

    def login(self, user, pw=PW, expect_ok=True):
        self.go("/login")
        self.page.fill("#username", user)
        self.page.fill("#password", pw)
        self.page.click("#submit-btn")
        if expect_ok:
            self.page.wait_for_url("**/dashboard")
            self.page.wait_for_selector("#dashboard-content:not([hidden])")
        else:
            self.page.wait_for_selector("#form-error:not([hidden])")
            return self.page.inner_text("#form-error")

    def ls(self, key):
        raw = self.page.evaluate(f"localStorage.getItem('{key}')")
        return json.loads(raw) if raw else None

    def account(self, user):
        return self.ls("spendwise.accounts")[user.lower()]

    def set_time(self, ms_from_now):
        self.context.clock.set_system_time(dt.datetime.now() + dt.timedelta(milliseconds=ms_from_now))

    def advance(self, ms):
        """Move the browser clock forward by `ms` from whatever time the page currently sees."""
        self.context.clock.set_system_time((self.page.evaluate("Date.now()") + ms) / 1000)

    def add_expense(self, title, amount, category="Food", date=None, note=""):
        self.go("/expenses")
        self.page.fill("#f-title", title)
        self.page.fill("#f-amount", str(amount))
        self.page.select_option("#f-category", category)
        if date:
            self.page.fill("#f-date", date)
        self.page.fill("#f-note", note)
        self.page.click("#form-submit")
        self.page.wait_for_selector(f"#expense-rows tr:has-text('{title}')")

    def rows(self):
        return self.page.eval_on_selector_all("#expense-rows tr", "rs => rs.map(r => r.children[1].childNodes[0].textContent)")

    def idb_records(self, store):
        return self.page.evaluate("""(store) => new Promise((res, rej) => {
            const r = indexedDB.open('spendwise');
            r.onsuccess = () => { const q = r.result.transaction(store).objectStore(store).getAll();
                q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
            r.onerror = () => rej(r.error); })""", store)

    # ================= Authentication =================
    def test_register_hashes_password_and_never_contacts_server(self):
        self.register("Alice")
        acc = self.account("Alice")
        self.assertEqual(acc["algorithm"], "PBKDF2-SHA256")
        self.assertGreaterEqual(acc["iterations"], 310000)
        self.assertEqual(len(acc["salt"]) , 24)      # 16 bytes base64
        self.assertEqual(len(acc["hash"]), 44)       # 32 bytes base64
        dump = json.dumps(self.page.evaluate("Object.assign({}, localStorage)"))
        self.assertNotIn(PW, dump)
        # nothing but GET page/static requests ever reached Flask; no password in any URL
        for method, url in self.requests:
            self.assertEqual(method, "GET", url)
            self.assertNotIn(PW, url)
            self.assertNotIn("api", url.split(str(self.port))[-1])
        self.assertEqual(self.page.inner_text("#user-name"), "Alice")

    def test_unique_salts_for_same_password(self):
        self.register("alice1")
        self.logout()
        self.register("bob12")
        a, b = self.account("alice1"), self.account("bob12")
        self.assertNotEqual(a["salt"], b["salt"])
        self.assertNotEqual(a["hash"], b["hash"])  # same password, different hash

    def test_register_validation_and_duplicates(self):
        self.go("/register")
        def attempt(u, p, c):
            self.page.fill("#username", u); self.page.fill("#password", p); self.page.fill("#confirm", c)
            self.page.click("#submit-btn")
            self.page.wait_for_selector("#form-error:not([hidden])")
            return self.page.inner_text("#form-error")
        self.assertIn("3 to 30", attempt("ab", "longenough1", "longenough1"))
        self.assertIn("letters, numbers", attempt("bad name!", "longenough1", "longenough1"))
        self.assertIn("at least 8", attempt("gooduser", "short", "short"))
        self.assertIn("do not match", attempt("gooduser", "longenough1", "different123"))
        self.register("Carol")
        self.logout()
        self.go("/register")
        self.assertIn("already taken", attempt("CAROL", "longenough1", "longenough1"))  # case-insensitive

    def test_login_logout_and_protected_pages(self):
        self.go("/dashboard")                              # not logged in -> redirected
        self.assertIn("/login", self.page.url)
        self.assertIn("log in", self.page.inner_text("#form-notice").lower())
        self.register("dave1")
        self.logout()
        self.assertIn("logged out", self.page.inner_text("#toasts"))
        for path in ("/dashboard", "/expenses"):
            self.go(path)
            self.assertIn("/login", self.page.url)
        self.assertIsNone(self.ls("spendwise.session"))
        self.login("dave1")
        self.assertEqual(self.page.inner_text("#user-name"), "dave1")
        # logged-in users skip the login page
        self.go("/login")
        self.page.wait_for_url("**/dashboard")

    def test_wrong_username_gives_generic_error(self):
        self.register("erin1")
        self.logout()
        msg = self.login("nobody", "whatever123", expect_ok=False)
        self.assertEqual(msg, "Incorrect username or password.")

    def test_progressive_lockout_persistence_and_reset(self):
        self.register("frank")
        self.logout()
        # two wrong attempts: counted, not locked
        m = self.login("frank", "wrong-pass-1", expect_ok=False)
        self.assertIn("2 attempts left", m)
        m = self.login("frank", "wrong-pass-2", expect_ok=False)
        self.assertIn("1 attempt left", m)
        self.assertEqual(self.account("frank")["failedAttempts"], 2)
        # third wrong attempt: first lockout = 1 hour
        m = self.login("frank", "wrong-pass-3", expect_ok=False)
        self.assertIn("locked", m)
        acc = self.account("frank")
        self.assertEqual(acc["lockLevel"], 1)
        remaining = acc["lockedUntil"] - self.page.evaluate("Date.now()")
        self.assertAlmostEqual(remaining / HOUR, 1.0, delta=0.01)
        # correct password is refused during the lock; remaining time is shown
        self.go("/login")
        self.page.fill("#username", "frank")
        self.page.wait_for_selector("#lock-banner:not([hidden])")
        self.assertIn("Try again in 1 hour", self.page.inner_text("#lock-banner"))
        self.assertTrue(self.page.is_disabled("#submit-btn"))
        res = self.page.evaluate(f"Auth.login('frank', '{PW}')")
        self.assertFalse(res["ok"]); self.assertTrue(res["locked"])
        self.assertIsNone(self.ls("spendwise.session"))
        # refresh does not reset the lock
        self.page.reload(); self.page.fill("#username", "frank")
        self.page.wait_for_selector("#lock-banner:not([hidden])")
        # closing and reopening the browser does not reset it (new context with same storage)
        state = self.context.storage_state()
        ctx2 = self.browser.new_context(storage_state=state)
        p2 = ctx2.new_page(); self.attach(p2)
        p2.goto(self.base + "/login"); p2.fill("#username", "frank")
        p2.wait_for_selector("#lock-banner:not([hidden])")
        ctx2.close()
        # 1h later: unlocked, 3 more attempts; the next lock is 2 hours (level 2)
        for level, hours in ((2, 2), (3, 4), (4, 8), (5, 16), (6, 32)):
            self.advance(self.account("frank")["lockedUntil"] - self.page.evaluate("Date.now()") + 1000)
            self.go("/login"); self.page.fill("#username", "frank")
            self.assertTrue(self.page.is_enabled("#submit-btn"))
            for i in range(3):
                self.login("frank", f"nope-{level}-{i}", expect_ok=False)
            acc = self.account("frank")
            self.assertEqual(acc["lockLevel"], level)
            self.assertEqual(acc["failedAttempts"], 0)
            self.assertAlmostEqual((acc["lockedUntil"] - self.page.evaluate("Date.now()")) / HOUR, hours, delta=0.01)
        # after the lock ends, a correct password logs in and resets everything
        self.advance(self.account("frank")["lockedUntil"] - self.page.evaluate("Date.now()") + 1000)
        self.login("frank", "oops-first", expect_ok=False)   # one failed attempt on the books
        self.assertEqual(self.account("frank")["failedAttempts"], 1)
        self.login("frank")
        acc = self.account("frank")
        self.assertEqual((acc["failedAttempts"], acc["lockLevel"], acc["lockedUntil"]), (0, 0, 0))

    def test_session_lasts_seven_days_then_expires(self):
        self.register("gina")
        s = self.ls("spendwise.session")
        now = self.page.evaluate("Date.now()")
        self.assertAlmostEqual((s["expiresAt"] - now) / DAY, 7.0, delta=0.01)
        self.set_time(6 * DAY + 23 * HOUR)                    # still inside the window
        self.go("/expenses")
        self.assertTrue(self.page.url.endswith("/expenses"))
        self.go("/")                                            # reopen the app: still logged in
        self.page.wait_for_selector("a:has-text('Open dashboard')")
        self.set_time(7 * DAY + 60 * 1000)                      # past the expiry
        self.go("/dashboard")
        self.assertIn("/login", self.page.url)
        self.assertIn("reason=expired", self.page.url)
        self.assertIn("7-day session has ended", self.page.inner_text("#form-notice"))
        self.assertIsNone(self.ls("spendwise.session"))
        self.login("gina")                                      # new login = new 7-day session
        s2 = self.ls("spendwise.session")
        self.assertAlmostEqual((s2["expiresAt"] - self.page.evaluate("Date.now()")) / DAY, 7.0, delta=0.01)

    def test_session_expiring_while_page_is_open_ends_access(self):
        self.register("hank")
        self.go("/expenses")
        self.set_time(8 * DAY)
        self.page.fill("#f-title", "Late"); self.page.fill("#f-amount", "10")
        self.page.click("#form-submit")                          # data operation re-checks the session
        self.page.wait_for_url("**/login**")
        self.assertIn("reason=expired", self.page.url)
        self.assertEqual(self.idb_records("expenses"), [])

    def test_tampered_sessions_are_rejected(self):
        self.register("ivy12")
        for evil in ({"userId": "x", "username": "ivy12", "expiresAt": 9999999999999},     # too far ahead
                     {"userId": "not-the-id", "username": "ivy12", "expiresAt": self.page.evaluate("Date.now()") + HOUR},
                     {"username": "ivy12"}):
            self.page.evaluate("s => localStorage.setItem('spendwise.session', JSON.stringify(s))", evil)
            self.go("/dashboard")
            self.assertIn("/login", self.page.url)

    # ================= Account isolation =================
    def test_accounts_are_isolated_and_data_is_restored_on_login(self):
        self.register("userA")
        self.add_expense("A-lunch", 100)
        self.add_expense("A-bus", 50, "Transport")
        self.go("/dashboard")
        self.page.fill("#budget-input", "5000"); self.page.click("#budget-form button")
        self.page.wait_for_selector("#budget-text:has-text('5,000')")
        self.logout()
        self.assertNotIn("A-lunch", self.page.content())

        self.register("userB")
        self.go("/expenses")
        self.page.wait_for_selector("#empty-state:not([hidden])")
        self.assertEqual(self.rows(), [])
        self.go("/dashboard")
        self.assertEqual(self.page.inner_text("#stat-all"), "₹0.00")
        self.assertTrue(self.page.is_visible("#budget-empty"))
        self.add_expense("B-coffee", 30)
        self.logout()

        self.login("userA")
        self.go("/expenses")
        self.assertCountEqual(self.rows(), ["A-lunch", "A-bus"])
        self.go("/dashboard")
        self.assertIn("5,000", self.page.inner_text("#budget-text"))
        self.logout()
        self.login("userB")
        self.go("/expenses")
        self.assertEqual(self.rows(), ["B-coffee"])
        # records in IndexedDB are tagged per account
        recs = self.idb_records("expenses")
        owners = {r["title"]: r["userId"] for r in recs}
        self.assertEqual(len(set(owners.values())), 2)
        self.assertEqual(owners["A-lunch"], owners["A-bus"])
        self.assertNotEqual(owners["A-lunch"], owners["B-coffee"])
        self.assertEqual(len(self.idb_records("budgets")), 1)
        # an account cannot edit or delete another account's record
        a_id = [r["id"] for r in recs if r["title"] == "A-lunch"][0]
        res = self.page.evaluate("""async (id) => { const u = Auth.checkSession().user;
            try { await ExpenseDB.deleteExpense(u.id, id); return 'deleted'; } catch (e) { return e.message; } }""", a_id)
        self.assertIn("no longer exists", res)
        self.assertEqual(len(self.idb_records("expenses")), 3)

    def test_data_persists_across_refresh_and_browser_restart(self):
        with tempfile.TemporaryDirectory() as profile:
            ctx = self.browser.browser_type.launch_persistent_context(profile)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            self.attach(page); page.on("dialog", lambda d: d.accept())
            page.goto(self.base + "/register")
            page.fill("#username", "jules"); page.fill("#password", PW); page.fill("#confirm", PW)
            page.click("#submit-btn"); page.wait_for_url("**/dashboard")
            page.goto(self.base + "/expenses")
            page.fill("#f-title", "Persisted"); page.fill("#f-amount", "77"); page.click("#form-submit")
            page.wait_for_selector("#expense-rows tr")
            page.reload(); page.wait_for_selector("#expense-rows tr")
            ctx.close()                                   # "close the browser"
            ctx = self.browser.browser_type.launch_persistent_context(profile)   # "reopen it"
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            self.attach(page)
            page.goto(self.base + "/expenses")           # session (localStorage) still valid
            page.wait_for_selector("#expense-rows tr")
            self.assertIn("Persisted", page.inner_text("#expense-rows"))
            ctx.close()

    # ================= Expenses =================
    def test_add_validate_edit_delete(self):
        self.register("kate1")
        self.go("/expenses")
        def submit(title, amount, date=None, expect=None):
            self.page.fill("#f-title", title); self.page.fill("#f-amount", amount)
            if date: self.page.fill("#f-date", date)
            self.page.click("#form-submit")
            self.page.wait_for_selector("#form-error:not([hidden])")
            self.assertIn(expect, self.page.inner_text("#form-error"))
        submit("", "10", expect="Title is required")
        submit("x", "", expect="Amount must be")         # (the browser itself blocks typing letters)
        submit("x", "-5", expect="greater than 0")
        submit("x", "99999999", expect="at most")
        tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
        submit("x", "10", tomorrow, expect="future")
        self.assertEqual(self.idb_records("expenses"), [])
        # add
        self.page.fill("#f-title", "  Canteen <b>lunch</b> "); self.page.fill("#f-amount", "123.456")
        self.page.fill("#f-date", dt.date.today().isoformat()); self.page.fill("#f-note", "with friends")
        self.page.click("#form-submit")
        self.page.wait_for_selector("#expense-rows tr")
        self.assertIn("Added", self.page.inner_text("#toasts"))
        row = self.page.inner_text("#expense-rows tr")
        self.assertIn("Canteen <b>lunch</b>", row)          # shown as text, not interpreted as HTML
        self.assertIn("₹123.46", row)                        # rounded, INR formatted
        self.assertEqual(self.page.locator("#expense-rows b").count(), 0)
        # edit
        self.page.click("#expense-rows button:has-text('Edit')")
        self.assertEqual(self.page.input_value("#f-title"), "Canteen <b>lunch</b>")
        self.assertEqual(self.page.inner_text("#form-title"), "Edit expense")
        self.page.fill("#f-title", "Dinner"); self.page.fill("#f-amount", "2500.5"); self.page.select_option("#f-category", "Bills")
        self.page.click("#form-submit")
        self.page.wait_for_selector("#expense-rows tr:has-text('Dinner')")
        row = self.page.inner_text("#expense-rows tr")
        self.assertIn("₹2,500.50", row); self.assertIn("Bills", row)
        self.assertEqual(self.page.inner_text("#form-title"), "Add expense")
        self.assertEqual(len(self.idb_records("expenses")), 1)
        # delete
        self.page.click("#expense-rows button:has-text('Delete')")
        self.page.wait_for_selector("#empty-state:not([hidden])")
        self.assertEqual(self.idb_records("expenses"), [])

    def test_indian_rupee_grouping(self):
        self.register("lakh1")
        self.add_expense("Big", 1234567.5)
        self.assertIn("₹12,34,567.50", self.page.inner_text("#expense-rows"))

    def test_search_filter_sort_and_csv(self):
        self.register("mona1")
        today = dt.date.today()
        d = lambda n: (today - dt.timedelta(days=n)).isoformat()
        self.add_expense("Pizza", 400, "Food", d(1), "friday party")
        self.add_expense("Metro", 60, "Transport", d(5))
        self.add_expense("Course", 1500, "Education", d(10), "python")
        self.add_expense("Salad", 150, "Food", d(20))
        self.add_expense('=HYPERLINK("evil")', 5, "Other", d(30), 'say "hi", ok')
        self.go("/expenses")
        self.page.wait_for_selector("#expense-rows tr")
        self.assertEqual(self.page.inner_text("#result-summary"), "5 results · ₹2,115.00")
        self.assertEqual(self.rows()[:2], ["Pizza", "Metro"])                       # newest first
        # search title and note, case-insensitive
        self.page.fill("#q", "PIZ"); self.assertEqual(self.rows(), ["Pizza"])
        self.page.fill("#q", "python"); self.assertEqual(self.rows(), ["Course"])
        self.page.fill("#q", "")
        # category
        self.page.select_option("#category", "Food"); self.assertEqual(self.rows(), ["Pizza", "Salad"])
        self.assertIn("(filtered)", self.page.inner_text("#result-summary"))
        self.page.select_option("#category", "")
        # date range (inclusive)
        self.page.fill("#start", d(10)); self.page.fill("#end", d(1))
        self.assertEqual(self.rows(), ["Pizza", "Metro", "Course"])
        self.page.fill("#start", d(5)); self.page.fill("#end", d(5)); self.assertEqual(self.rows(), ["Metro"])
        self.page.fill("#start", d(1)); self.page.fill("#end", d(10))                 # inverted range
        self.assertIn("must be on or before", self.page.inner_text("#filter-error"))
        self.page.click("#reset-filters"); self.assertEqual(len(self.rows()), 5)
        # sorting
        self.page.select_option("#sort", "highest"); self.assertEqual(self.rows()[:2], ["Course", "Pizza"])
        self.page.select_option("#sort", "lowest"); self.assertEqual(self.rows()[:2], ['=HYPERLINK("evil")', "Metro"])
        self.page.select_option("#sort", "oldest"); self.assertEqual(self.rows()[0], '=HYPERLINK("evil")')
        self.page.select_option("#sort", "newest")
        self.page.fill("#q", "xyz"); self.page.wait_for_selector("#empty-state:not([hidden])")
        self.assertIn("No expenses match", self.page.inner_text("#empty-state"))
        self.page.click("#reset-filters")
        # CSV: exports the filtered list
        self.page.select_option("#category", "Food")
        with self.page.expect_download() as info:
            self.page.click("#export-btn")
        dl = info.value
        self.assertRegex(dl.suggested_filename, r"^expenses_\d{4}-\d{2}-\d{2}\.csv$")
        with open(dl.path(), encoding="utf-8-sig") as fh:
            text = fh.read()
        rows = list(csv.reader(io.StringIO(text)))
        self.assertEqual(rows[0], ["Date", "Title", "Category", "Amount", "Note"])
        self.assertEqual(rows[1:], [[d(1), "Pizza", "Food", "400.00", "friday party"], [d(20), "Salad", "Food", "150.00", ""]])
        # CSV: formula-injection protection and quote escaping
        self.page.click("#reset-filters"); self.page.fill("#q", "hyperlink")
        with self.page.expect_download() as info:
            self.page.click("#export-btn")
        with open(info.value.path(), encoding="utf-8-sig") as fh:
            rows = list(csv.reader(io.StringIO(fh.read())))
        self.assertEqual(rows[1][1], '\'=HYPERLINK("evil")')
        self.assertEqual(rows[1][4], 'say "hi", ok')

    # ================= Dashboard =================
    def test_dashboard_numbers_budget_trend_and_recent(self):
        self.register("nina1")
        self.go("/dashboard")
        self.assertIn("No spending", self.page.inner_text("#category-bars"))
        self.assertEqual(self.page.inner_text("#stat-top"), "–")
        today = dt.date.today()
        first = today.replace(day=1)
        def months_back(n):
            y, m = today.year, today.month - n
            while m <= 0: y, m = y - 1, m + 12
            return dt.date(y, m, 15)
        self.add_expense("Rent", 3000, "Bills", today.isoformat())
        self.add_expense("Food1", 1000, "Food", today.isoformat())
        self.add_expense("Food2", 500, "Food", first.isoformat())
        self.add_expense("Old1", 700, "Shopping", months_back(1).isoformat())
        self.add_expense("Old3", 200, "Health", months_back(3).isoformat())
        self.add_expense("TooOld", 999, "Other", months_back(7).isoformat())  # outside 6-month window
        self.go("/dashboard")
        t = lambda i: self.page.inner_text(i)
        self.assertEqual(t("#stat-month-total"), "₹4,500.00")
        self.assertEqual(t("#stat-month-count"), "3")
        self.assertEqual(t("#stat-top"), "Bills")                  # 3000 > 1500
        self.assertEqual(t("#stat-all"), "₹6,399.00")
        self.assertIn("Bills", t("#category-bars")); self.assertIn("₹3,000.00", t("#category-bars"))
        self.assertTrue(self.page.is_visible("#budget-empty"))
        # trend: last 6 months, oldest first
        bars = self.page.eval_on_selector_all("#trend-chart .col", "cs => cs.map(c => [c.title])")
        self.assertEqual(len(bars), 6)
        titles = [b[0] for b in bars]
        self.assertTrue(titles[5].endswith("₹4,500.00")); self.assertTrue(titles[4].endswith("₹700.00"))
        self.assertTrue(titles[2].endswith("₹200.00")); self.assertTrue(titles[3].endswith("₹0.00"))
        # recent: newest 5 of 6 expenses
        recent = self.page.inner_text("#recent-list")
        self.assertIn("Rent", recent); self.assertIn("Old3", recent); self.assertNotIn("TooOld", recent)
        # budget: under -> 90% warn colour, over -> alert
        def set_budget(v):
            self.page.fill("#budget-input", v); self.page.click("#budget-form button")
            if v == "0":
                self.page.wait_for_selector("#budget-empty:not([hidden])")
            else:
                self.page.wait_for_selector(f"#budget-text:has-text('of ₹{int(v):,}')")
        set_budget("5000")
        self.assertEqual(self.page.get_attribute(".progress", "aria-valuenow"), "90")
        self.assertIn("₹500.00 left", t("#budget-text"))
        self.assertIn("warn", self.page.get_attribute(".progress", "class"))
        self.assertTrue(self.page.is_hidden("#budget-alert"))
        set_budget("4000")
        self.assertIn("over", self.page.get_attribute(".progress", "class"))
        self.assertIn("₹500.00 over budget", t("#budget-text"))
        self.assertTrue(self.page.is_visible("#budget-alert")); self.assertIn("Over budget", t("#budget-alert"))
        self.assertEqual(self.page.get_attribute(".progress", "aria-valuenow"), "100")
        self.page.reload(); self.page.wait_for_selector("#dashboard-content:not([hidden])")
        self.assertEqual(self.page.input_value("#budget-input"), "4000")   # persisted
        set_budget("0")
        self.assertTrue(self.page.is_visible("#budget-empty")); self.assertTrue(self.page.is_hidden("#budget-alert"))
        self.page.fill("#budget-input", "-5"); self.page.click("#budget-form button")
        self.assertIn("Budget must be", self.page.inner_text("#toasts"))

    def test_sample_data_button(self):
        self.register("sam11")
        self.page.click("#sample-btn")
        self.page.wait_for_selector("#recent-list table")
        self.go("/expenses")
        self.page.wait_for_selector("#expense-rows tr")
        self.assertEqual(len(self.rows()), 14)

    # ================= Layout / navigation =================
    def test_mobile_layout_and_nav(self):
        self.register("olga1")
        self.add_expense("Mobile row", 10)
        self.page.set_viewport_size({"width": 375, "height": 740})
        for path in ("/", "/dashboard", "/expenses", "/login", "/register"):
            self.go(path)
            overflow = self.page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            self.assertLessEqual(overflow, 0, f"horizontal scroll on {path}")
        self.go("/dashboard")
        self.assertFalse(self.page.is_visible("#main-nav"))
        self.page.click("#nav-toggle")
        self.assertTrue(self.page.is_visible("#main-nav a:has-text('Expenses')"))
        self.page.click("#main-nav a:has-text('Expenses')")
        self.page.wait_for_url("**/expenses")
        self.assertTrue(self.page.is_visible("#expense-rows td:has-text('Mobile row')"))

    def test_404_page(self):
        self.page.goto(self.base + "/missing")
        self.assertIn("Page not found", self.page.content())
        self.problems[:] = [p for p in self.problems if p[0] != "console"]   # expected 404 resource log
        self.problems[:] = [p for p in self.problems if not (p[0] == "http" and p[2] == 404)]

    def test_logout_in_other_tab_ends_this_tab(self):
        self.register("pete1")
        self.go("/expenses")
        tab2 = self.context.new_page(); self.attach(tab2)
        tab2.goto(self.base + "/dashboard"); tab2.wait_for_selector("#logout-btn:not([hidden])")
        tab2.click("#logout-btn"); tab2.wait_for_url("**/login")
        self.page.wait_for_url("**/login**", timeout=5000)


if __name__ == "__main__":
    unittest.main()
