# Features

## Authentication
- **Register** with a username (3–30 characters: letters, numbers, `.` `-` `_`; case-insensitive) and a password (8+ characters, entered twice). Registration logs you in.
- **Log in** with username and password. Generic error "Incorrect username or password." for unknown users or wrong passwords.
- **7-day session**: after login you stay signed in for seven days; afterwards you are sent to the login page with a notice.
- **Lockout**: three wrong passwords in a row lock the account (1 h, 2 h, 4 h, 8 h, 16 h… doubling). A live countdown shows the remaining time.
- **Log out** from the top bar. Protected pages (`/dashboard`, `/expenses`) redirect to login when there is no valid session.
- Details: [AUTHENTICATION.md](AUTHENTICATION.md).

## Dashboard
- **Spent this month**, **Expenses this month**, **Top category** (this month), **All-time total**.
- **Charts and summaries**: "This month by category" bars and a "Last 6 months" column chart (current month on the right).
- **Recent expenses**: the five newest.
- Empty states with a *Load sample data* button for trying the app.

## Budget management
- Set a monthly budget in ₹ (0 clears it; maximum ₹1,00,00,000).
- Progress bar: teal normally, amber from 80 %, red when over.
- **Over-budget warning**: a red banner says how much you are over.
- The budget is stored per account.

## Expense management
- **Add** with title (≤ 80 chars), amount (> 0, ≤ ₹1,00,00,000, rounded to paise), category, date (not in the future) and optional note (≤ 200 chars).
- **Edit**: *Edit* loads the row into the form; *Save changes* or *Cancel*.
- **Delete** with a confirmation prompt.
- Inline error messages and toast notifications (success/error).

## Search and filtering
- Search title and note (case-insensitive), filter by category and by date range (inclusive), sort by newest, oldest, highest or lowest amount.
- The result count and total reflect the active filters. An invalid range ("from" after "to") shows a message.

## CSV export
*Download CSV* exports exactly what is shown by the current filters: `Date, Title, Category, Amount, Note`. The file is created in your browser. Cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheets do not run them as formulas.

## Display
Indian Rupee format with Indian digit grouping (₹12,34,567.50), loading states, responsive layout (mobile menu, stacked expense cards on phones).
