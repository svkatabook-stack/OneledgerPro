# Optional manual bill numbers

Prepared on the feature branch; not applied to production yet.

The transaction form includes Bill Number (optional) immediately below Amount/Weight.
Blank entries save without a bill number. Nonblank references are trimmed, uppercased,
limited to 64 characters, and unique within the ledger (including deleted transactions).
The existing ledger filter, receipts, and exports use the entered reference. Existing
OLP numbers remain unchanged. Local demo sample fixtures use DEMO references.

Before deploying this frontend, apply `202610070003_optional_manual_bills.sql` once.
It removes the automatic numbering trigger, allows null numbers, and updates the write
RPC to accept the supplied reference. The old private counter is retained but unused.
This migration affects the shared database used by main and branch; defer until the
user completes local review and approves the production release.

Local demo tests cover manual input, multiple blank entries, persistence and search;
cloud mocks cover save/retry/search/export. PostgreSQL tests cover nullable bills,
duplicate rejection, retries and role access. Existing automatic-number release notes
in RELEASE_20261007.md describe the prior release and are superseded by this change.
