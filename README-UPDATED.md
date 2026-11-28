# DNS Academy ERP – Completed Feature Update

This update is based on the original `erpprojectdns/arp_school` project and follows its existing Express + EJS + MySQL structure.

## Before replacing your project

1. Take a backup of your existing database.
2. Keep your existing `.env` file. This ZIP intentionally does not include or overwrite it.
3. Extract the ZIP and use the `erpprojectdns/arp_school` folder.
4. Run:

   ```bash
   npm install
   npm run dev
   ```

The existing `initializeSchema()` startup flow runs additive migrations. It adds missing student profile columns, schedule fields and the `general_qr_collections` table. It does not drop existing tables or columns. Old `father_phone` values are copied to the new `mobile` column only when that column is first created; existing `created_at` dates are copied to `admission_date` only when that column is first created.

## Included updates

### Student admission
- Three sections: Personal Information, Academic Information, Fee Information.
- New stored fields: `mobile`, `address`, `board`, `student_class`, `stream`, `admission_date`.
- Existing category/subcategory tables and dynamic subcategory endpoint are retained.
- Existing legacy fields are retained and hidden fields preserve their values during edit.

### Student list
- Student, father and mother names; mobile and alternate mobile; board, class and admission date.
- Database-backed search, board/class filters, admission date range and 25 / 50 / 100 pagination.
- Archive and restore use a soft archive flag; student and payment records are not deleted.

### Student profile and payments
- Existing payment-history and cash collection logic retained.
- Schedule includes due date, preferred mode, due/received status, edit and cancel.
- Schedule edits cannot reduce an amount below paid/pending transactions or exceed the total course fee.
- Existing Cashfree link/QR flow remains available.
- Paid receipts can be printed.

### QR Payment Collection
- Student QR creates a Cashfree payment link for a selected installment and records it only after the verified webhook confirms payment.
- General QR uses a separate `general_qr_collections` table and does not change a student's due.
- Paid general collections can later be linked to a student's installment; the installment balance is checked and a payment-history entry is added.
- General QR requires payer mobile because the current Cashfree Payment Link integration requires customer phone details.

### Dashboard
- Live database values for students, fees, collected amounts, remaining due, today's collection, upcoming schedules, overdue schedules and general QR collections.

## Preserved
- `config/database.js`
- `app.js`
- Login and OTP controller
- Authentication and permission middleware
- Cashfree credentials/settings storage and encryption
- Existing dynamic categories/subcategories
- Existing fee-payment records and receipt-related payment references

## Verification performed
- All project JavaScript files passed `node --check`.
- All EJS templates compiled.
- Changed EJS views rendered using representative test data.
- All 19 non-server JavaScript modules imported successfully.
- Database connection configuration, login/OTP, auth middleware, Cashfree settings model/controller and app bootstrap were byte-for-byte unchanged.

A live MySQL migration and real Cashfree payment were not executed in this environment. Test first against a database backup/staging copy and verify the Cashfree webhook URL is configured in the existing Cashfree settings.
