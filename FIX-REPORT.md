# Fix report – Admission date and optional category fields

- Fixed admission-date validation to accept valid `YYYY-MM-DD` dates and reject impossible calendar dates.
- Fixed related incorrectly escaped numeric/decimal and phone-digit regular expressions in fee and Cashfree helper code.
- Made Category and Subcategory optional in the admission form and server-side validation.
- Blank category/subcategory values are stored as SQL NULL; selecting a subcategory still requires a matching category.
- Updated student lookup joins so profiles continue to load when category/subcategory are NULL.
- Added an additive schema migration to make existing student category/subcategory columns nullable without deleting existing values.
- Kept dynamic subcategory loading for users who choose a category.

## Checks performed

- JavaScript syntax check across all project `.js` files: passed.
- Focused validation tests for valid/invalid dates, leap day, optional category IDs, category-less admission, and fee amount validation: passed.
- ZIP archive integrity check: passed.

## Not performed

- Live MySQL migration and browser end-to-end tests could not be run in this environment because project dependencies were not available from the local npm cache and dependency installation timed out. The schema migration will run on application startup; back up the database before deploying.
