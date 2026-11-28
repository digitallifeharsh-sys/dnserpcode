# DNS Academy ERP — Cleanup Report

## Kept functional modules
- Dashboard: student, fee, collection, due, upcoming and overdue summaries.
- Students: admission form, student listing, edit, archive and restore.
- Categories: category/subcategory management used by student admission.
- Student payments: installments, cash/Cashfree payment flow, payment history and receipt.
- QR collection: student-linked QR and standalone general QR collections.
- Cashfree settings and webhook handling.
- Users & permissions, login/OTP, and system settings.

## Removed unused placeholder entries
- Products
- Orders
- Customers
- Inventory
- Invoices
- Reports (no implemented route/page)
- My Profile placeholder link (no implemented profile page)
- Demo order/revenue chart JavaScript and Chart.js dependency include
- Old ecommerce dashboard-only CSS selectors

No category/subcategory functionality, student fee/payment logic, Cashfree integration, or previously added admission/dashboard/QR features was intentionally removed.

## Validation performed
- `node --check` passed for application JavaScript files.
- EJS compilation passed for all 18 templates.
- Confirmed there are no remaining sidebar permission checks or links for the removed placeholder modules, and no old demo chart IDs.

## Not verified in this package-only pass
- Live MySQL migration against the user's database.
- Live Cashfree sandbox/production transaction and webhook delivery.
- Browser visual test against the user's server and database.

Keep your existing `.env` file and database backup. The archive intentionally excludes `.env`, `.git`, and `node_modules`.
