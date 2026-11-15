# Project Overview

## What SpendWise does
SpendWise is a small web app for recording personal spending, setting a monthly budget and seeing a summary of where the money went. It is written in Python with Flask. The Flask server only serves pages; your accounts and expenses live in your own browser.

## The problem it solves
Small daily expenses are easy to forget, spreadsheets are tedious, and most expense apps ask you to create a cloud account and hand over your financial data. SpendWise offers a quick, private alternative: open the page, log an expense in seconds, and see your month at a glance, with nothing leaving your device.

## Main features
- Browser-only registration and login with a 7-day session and progressive lockout
- Dashboard: monthly total, top category, budget progress, six-month trend, recent expenses
- Add, edit, delete, search, filter, sort expenses
- Monthly budget with an over-budget warning
- CSV export, Indian Rupee formatting, responsive design
- Separate data for every account in the same browser

## Intended users
- Students and early-career professionals tracking everyday spending
- Anyone who wants a private, no-cloud tracker for personal use on one device
- Beginner Python developers who want a readable Flask + vanilla JavaScript example project

## Not intended for
Shared computers where you do not trust the other users, multi-device sync, family/team accounts or anything needing real online-account security. See [AUTHENTICATION.md](AUTHENTICATION.md) for the limitations.
