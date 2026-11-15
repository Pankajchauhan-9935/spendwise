# Deployment

SpendWise stays a Python + Flask app. The code lives on GitHub and is hosted on **Vercel**, which runs Flask on its Python runtime.

## 1. GitHub repository setup
```bash
cd spendwise
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/spendwise.git
git push -u origin main
```
Create the empty repository on GitHub first. `.gitignore` excludes `venv/`, `.env` and caches. The repository contains no user data and no secrets, because the app needs none.

## 2. Deploy on Vercel
1. Sign in at vercel.com with GitHub.
2. **Add New → Project**, pick the `spendwise` repository.
3. Leave the settings as they are (Framework: Flask is detected from `app.py`) and click **Deploy**.
4. Every later `git push` to `main` redeploys automatically.

Or with the CLI: `npm i -g vercel`, then `vercel` inside the project folder.

### How Vercel finds the app
- Vercel looks for a Flask instance named `app` in `app.py` at the project root. This project already has it.
- Dependencies come from `requirements.txt` (just Flask). No start command, build command or `vercel.json` is needed.
- The default Python version is used; to pin one, add a `.python-version` file.
- Templates (`templates/`) are bundled with the function automatically.

### Why static files are in `public/`
Vercel serves everything in `public/` from its CDN and **ignores Flask's own static folder**. So CSS, JavaScript and images are in `public/`. `app.py` sets `static_folder="public", static_url_path=""`, so Flask serves the same folder at the site root when you run locally. The URLs (`/css/style.css`, `/js/auth.js`) are the same in both places. Do not move these files back to a `static/` folder.

## 3. Environment configuration
None required. Never set `FLASK_DEBUG=1` on Vercel. Debug mode is off unless explicitly enabled. `HOST`, `PORT` and `FLASK_DEBUG` are only used by `python app.py` locally.

## 4. Local development
`python app.py` is enough. To run it exactly as Vercel does: `vercel dev` (needs the Vercel CLI).

## 5. Production notes
- **HTTPS is required** for the browser's Web Crypto API. Vercel provides it by default.
- Users' accounts and expenses are stored in *their* browser for your site's origin. A new domain starts with empty storage, because the data belongs to the old origin (`*.vercel.app` preview URLs also have separate storage per URL).
- Redeploying never touches user data, since the server holds none, and nothing is written to the server's disk (important, because Vercel's filesystem is read-only/ephemeral).
- Because the server only serves pages, there is no database or secret to configure.

## 6. Other Python hosts
Render, Railway, PythonAnywhere and similar work too: build with `pip install -r requirements.txt gunicorn`, start with `gunicorn app:app`.

## 7. GitHub Pages limitations
GitHub Pages serves only static files and **cannot run Flask**. Use GitHub for source code and Vercel (or another Python host) to run it.

## 8. Browser-only storage limitations
Hosting does not change how data works: each visitor's data stays in their own browser on their own device. It does not sync, it is lost if they clear site data, and it is not safe against someone who controls their browser profile. Tell users to export CSV backups. See [DATA_STORAGE.md](DATA_STORAGE.md) and [AUTHENTICATION.md](AUTHENTICATION.md).
