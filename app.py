"""SpendWise - a personal expense tracker.

Flask only serves the HTML pages and static files. All account and expense
data lives in the visitor's own browser (localStorage + IndexedDB), so this
server never receives or stores personal information.
"""
import os

from flask import Flask, render_template

# Single source of truth for the category lists in the expense form and filters.
CATEGORIES = ["Food", "Transport", "Education", "Bills", "Shopping",
              "Entertainment", "Health", "Other"]

# Static files live in public/ because Vercel serves public/ from its CDN (and ignores
# Flask's static folder). Serving the same folder at the site root keeps the URLs
# identical locally (Flask) and on Vercel: /css/style.css, /js/auth.js, ...
app = Flask(__name__, static_folder="public", static_url_path="")


@app.after_request
def add_security_headers(response):
    """Basic hardening. The CSP also guarantees the app never talks to other sites."""
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response


# ---------- Page routes (all GET, none of them touch user data) ----------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/login")
def login():
    return render_template("login.html")


@app.route("/register")
def register():
    return render_template("register.html")


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


@app.route("/expenses")
def expenses():
    return render_template("expenses.html", categories=CATEGORIES)


@app.errorhandler(404)
def not_found(_):
    return render_template("404.html"), 404


if __name__ == "__main__":
    # Debug mode is OFF unless you explicitly set FLASK_DEBUG=1 for local development.
    app.run(host=os.environ.get("HOST", "127.0.0.1"),
            port=int(os.environ.get("PORT", "5000")),
            debug=os.environ.get("FLASK_DEBUG") == "1")
