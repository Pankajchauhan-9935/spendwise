"""Server-side tests: pages, routes, headers and "no personal data on the server".

Run from the project folder:   python -m unittest discover -s tests -v
"""
import os
import re
import sys
import unittest
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from app import app  # noqa: E402

PAGES = ["/", "/login", "/register", "/dashboard", "/expenses"]


class LinkCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs, self.scripts, self.inputs = [], [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("a", "link") and a.get("href"):
            self.refs.append(a["href"])
        if tag == "script":
            self.scripts.append(a)
            if a.get("src"):
                self.refs.append(a["src"])
        if tag == "input":
            self.inputs.append(a)


def parse(html):
    p = LinkCollector()
    p.feed(html)
    return p


class PageTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_pages_load(self):
        for path in PAGES:
            r = self.client.get(path)
            self.assertEqual(r.status_code, 200, path)
            self.assertIn(b"SpendWise", r.data)

    def test_unknown_page_is_404_with_friendly_page(self):
        r = self.client.get("/does-not-exist")
        self.assertEqual(r.status_code, 404)
        self.assertIn(b"Page not found", r.data)

    def test_old_server_side_routes_are_gone(self):
        for path in ["/export", "/budget", "/expenses/add", "/expenses/abc/edit", "/api/expenses"]:
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_no_broken_links_or_missing_files(self):
        for path in PAGES:
            refs = parse(self.client.get(path).get_data(as_text=True)).refs
            self.assertTrue(refs)
            for ref in refs:
                if ref.startswith("#"):
                    continue
                self.assertFalse(ref.startswith(("http://", "https://", "//")), f"external ref {ref} on {path}")
                r = self.client.get(ref)
                r.close()
                self.assertEqual(r.status_code, 200, f"{ref} (from {path})")

    def test_all_page_scripts_exist_and_none_are_inline(self):
        for path in PAGES:
            for s in parse(self.client.get(path).get_data(as_text=True)).scripts:
                self.assertIn("src", s, f"inline script on {path} would break the CSP")

    def test_security_headers(self):
        r = self.client.get("/")
        csp = r.headers["Content-Security-Policy"]
        self.assertIn("default-src 'self'", csp)
        self.assertIn("script-src 'self'", csp)
        self.assertNotIn("unsafe-inline", csp)
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")


class NoServerSideDataTests(unittest.TestCase):
    def test_only_get_routes(self):
        for rule in app.url_map.iter_rules():
            self.assertTrue(rule.methods <= {"GET", "HEAD", "OPTIONS"}, f"{rule} accepts {rule.methods}")
            self.assertNotIn("api", rule.rule)

    def test_post_is_rejected_everywhere(self):
        client = app.test_client()
        for path in PAGES:
            self.assertEqual(client.post(path, data={"password": "secret-pw"}).status_code, 405, path)

    def test_forms_cannot_submit_passwords(self):
        """Password inputs have no name, so even without JavaScript no password is ever sent."""
        client = app.test_client()
        for path in ["/login", "/register"]:
            inputs = parse(client.get(path).get_data(as_text=True)).inputs
            pw = [i for i in inputs if i.get("type") == "password"]
            self.assertTrue(pw)
            for i in pw:
                self.assertNotIn("name", i)

    def test_forms_have_no_action(self):
        for path in ["/login", "/register", "/expenses", "/dashboard"]:
            html = app.test_client().get(path).get_data(as_text=True)
            self.assertNotRegex(html, r"<form[^>]*\saction=", path)
            self.assertNotRegex(html, r"<form[^>]*\smethod=", path)

    def test_debug_off_by_default(self):
        self.assertFalse(app.debug)
        src = open(os.path.join(ROOT, "app.py"), encoding="utf-8").read()
        self.assertIn('os.environ.get("FLASK_DEBUG") == "1"', src)
        self.assertNotIn("debug=True", src)

    def test_no_data_files_or_secrets_in_project(self):
        self.assertFalse(os.path.exists(os.path.join(ROOT, "data")))
        for folder, _, files in os.walk(ROOT):
            if any(part in folder for part in ("__pycache__", ".git", "venv")):
                continue
            for name in files:
                self.assertNotIn(name, {"expenses.json", "settings.json", ".env"})

    def test_python_code_has_no_database_or_filesystem_storage(self):
        src = open(os.path.join(ROOT, "app.py"), encoding="utf-8").read().lower()
        for word in ["sqlite", "mysql", "mongo", "redis", "open(", "json.dump", "secret_key", "session["]:
            self.assertNotIn(word, src)

    def test_requirements_are_minimal(self):
        reqs = [l.strip().lower() for l in open(os.path.join(ROOT, "requirements.txt")) if l.strip()]
        names = {re.split(r"[<>=!~]", r)[0] for r in reqs}
        self.assertEqual(names, {"flask"})

    def test_static_code_makes_no_network_calls(self):
        for folder, _, files in os.walk(os.path.join(ROOT, "public", "js")):
            for name in files:
                code = open(os.path.join(folder, name), encoding="utf-8").read()
                for banned in ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket"]:
                    self.assertNotIn(banned, code, f"{name} uses {banned}")


if __name__ == "__main__":
    unittest.main()
