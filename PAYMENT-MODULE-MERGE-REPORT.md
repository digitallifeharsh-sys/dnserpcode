# DNS Academy ERP — Full Fee Payment and Installment Integration

## Source and target

- Payment-system source: `DNS-Academy-ERP-Updated(8).zip`
- Target application: `DNS-Academy-ERP-8000-Date-Category-Fixed.zip`
- Target stack and conventions retained: Express, EJS, MySQL, Bootstrap, ES modules.

## Integrated functionality

- Collect Fee Payment form with total fee, paid so far, available amount, student ID, amount, fill-full-due, payment date, mode, transaction reference and remarks.
- Complete Payment History table with receipt number, date, amount, mode, transaction reference and remarks.
- Student-level Schedule Payment tab.
- Global Scheduled Payments page with student selection, installment label, scheduled amount/date, payment mode, transaction reference and remarks.
- Upcoming, due today, overdue, partial, received and cancelled statuses.
- Receive, edit and cancel actions.
- Recording an installment receipt updates the fee-payment ledger and schedule balance in one transaction.
- Excel export for payment history and schedule.
- Dashboard collected totals and upcoming/overdue reminders now include the unified fee and schedule tables.

## Existing QR collection kept separate

- Existing QR Collection page, Cashfree settings, general QR collection tables and QR routes are retained.
- Existing successful student QR payments are migrated into the unified fee-payment history with a unique source-payment ID, so the migration is repeatable without duplicate history rows.
- Future successful Cashfree student payments and the legacy cash-installment path are synced into the unified fee-payment ledger.
- Pending QR amounts and outstanding legacy QR installments are included when calculating available-to-collect amounts.
- No QR generation control has been added to the new Scheduled Payments form.

## Database changes

On startup, the existing schema initializer now creates `fee_payments` and `scheduled_payments` and adds the scheduled transaction-reference field if missing. Existing student, category, subcategory, installment, Cashfree and QR tables are not dropped. The migration copies existing successful rows from `student_payments` into `fee_payments` using `source_student_payment_id` as an idempotency key.

## Explicitly not included

- Receipt-print modal or print workflow.
- QR generation from the Scheduled Payments screen.
- Replacing the existing QR Collection dashboard.

## Checks performed

- `node --check` passed for all 27 project JavaScript files.
- All relative JavaScript imports resolved to existing files.
- Both changed EJS views passed a scriptlet syntax compilation check.
- Shared date/amount/payment-mode validators passed isolated checks.
- XLSX writer produced a ZIP-valid workbook in an isolated check.

## Not performed

A live MySQL migration, real payment transaction, Cashfree webhook round trip and browser/device acceptance test were not performed. The local npm cache did not contain all locked dependencies (`npm ci --offline` stopped on a missing cached package), so this ZIP must be tested against a backed-up staging database before production use.

## Safe rollout

1. Back up the current database and `.env`.
2. Extract the ZIP into a separate test directory first.
3. Keep the existing database credentials and Cashfree credentials in `.env`; do not replace them with placeholders.
4. Install dependencies with `npm ci` where network/package registry access is available.
5. Start the app and review schema migration logs.
6. Test a manual collection, a scheduled installment, a partial receipt, a completed receipt, an edit, a cancellation and a successful Cashfree webhook using test records.
7. Compare the student's payment history and dashboard totals with the database before deploying.
