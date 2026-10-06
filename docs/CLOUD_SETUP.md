# OneLedger Pro cloud setup

Project: `zlcittlgjvsiwstkhjvv` · Region: Mumbai.
Current website: https://comfy-klepon-85d3fc.netlify.app (rename later).
Owner, sender, and recipient: `s.vkatabook@gmail.com`.

## 1. Database

In the new project's SQL Editor, run `supabase/schema.sql` once. It is the same script as `supabase/migrations/202610030001_cloud_foundation.sql`; do not apply both. This is a fresh-project baseline, not an upgrade script for the old shop database.

The six tables are organizations, profiles, customers, transactions, chit_schemes, and report_runs. RLS is enabled on all six. Anonymous clients have no access. A profile created for a new Auth user starts as an unlinked View account. Clients cannot change profile roles, organization membership, or stored balance columns.

Customer writes are limited to Owner/Staff. Transaction writes use `record_transaction` and owner-only `delete_transaction`. Both verify the authenticated user's organization; the database computes balances under row locks and makes retries idempotent. Direct transaction writes are not granted to browser clients.

## 2. Owner login

In Supabase → Authentication → Users → Add user → Create user:

- Email: `s.vkatabook@gmail.com`.
- Enter a new strong password directly in Supabase, not in chat or Git.
- Confirm the email using the administrator's auto-confirm option.

Then run `supabase/seed.sql` in SQL Editor. It links only that confirmed user to the OneLedger organization as Owner and creates the five default Chit schemes. The script does not set any password. Keep organization/role administration restricted to the administrator dashboard for now.

The cloud login presents Owner, Staff, and View buttons. Each role uses a separate shared password verified by Supabase Auth; account identifiers are internal to the application. There is no localStorage fallback granting cloud access. Local demo records are separate and are not migrated automatically.

## 3. Netlify

In the connected site's environment variables, add these build-time values:

```
VITE_APP_MODE=cloud
VITE_SUPABASE_URL=https://zlcittlgjvsiwstkhjvv.supabase.co
VITE_SUPABASE_ANON_KEY=<the supplied sb_publishable_ key>
```

The legacy variable name accepts the new publishable-key format. Never put a secret/service-role key here. Build command is `npm run build`, output directory `dist`, Node version 22.

Trigger a new deployment after setting the variables. Add the website URL to Supabase Authentication URL Configuration when enabling email links/password recovery. Password sign-in itself does not use a redirect. Update configured URLs if the site is renamed.

The local `.env.local` remains in local mode until explicitly switched. Use the Netlify cloud site for the owner sign-in check once provisioning is complete.

## 4. Report email

Enable Gmail 2-Step Verification and create an app password for OneLedger Reports. Enter it directly into Supabase → Edge Functions → Secrets as `GMAIL_PASS`. Do not share it in chat.

Required function secrets:

| Name | Value |
|---|---|
| GMAIL_USER | s.vkatabook@gmail.com |
| GMAIL_PASS | Gmail app password, entered privately |
| REPORT_TO | s.vkatabook@gmail.com |
| REPORT_ORG_ID | 00000000-0000-0000-0000-000000000001 |
| CRON_SECRET | New random secret, at least 32 characters |

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions. These are never sent to the browser.

Deploy the `send-report` folder, including `report-period.js`, using the dashboard or authenticated Supabase CLI:

```
supabase functions deploy send-report --project-ref zlcittlgjvsiwstkhjvv
```

`supabase/config.toml` disables the platform JWT gate for this cron-only function. The handler itself requires POST plus an exact `x-cron-secret`; it returns 503 if any required secret is missing and 401 for an incorrect secret. Do not remove its secret check.

Use the dashboard function tester to POST `?type=daily` with the secret header, then verify the email and Excel attachment at the recipient. A unique report_runs row prevents duplicate period attempts. After an SMTP failure or unconfirmed send, inspect the logs and Gmail Sent folder before an administrator authorizes a retry; the function deliberately does not resend automatically.

Before enabling cron, store `oneledger_project_url` and `oneledger_cron_secret` in Supabase Vault, then run `supabase/cron_report.sql`. The Vault secret must match the function's CRON_SECRET.

Schedules:

- Daily 00:15 IST: previous complete calendar day.
- Sunday 08:00 IST: previous Sunday through Saturday, all seven days.

Reports fetch all pages and fail on database errors. Balances represent the current state when the report runs, while transaction totals cover the stated reporting dates. Adding or backdating a transaction after a report has run does not revise an already sent report.

SMTP for scheduled reports and Supabase Auth email are separate configurations. Basic owner password login does not depend on Gmail report setup. Auth invitations/recovery emails need the Auth SMTP settings if the project's default mail service is insufficient.

## Verification

- The schema and permissions were executed in an isolated PostgreSQL 14 database with Supabase auth-role stubs.
- Tests cover organization isolation, anonymous denial, read-only writes, role/balance protection, idempotent transaction retry and deletion.
- Browser tests exercise email/password login through a mocked API, deny unlinked users, ignore forged demo sessions, reject View transaction entry, and keep failed writes unsaved.
- Existing local workflow smoke tests still pass.
- Report-period tests cover IST/year boundaries and seven-day weekly coverage.

These checks do not substitute for verifying live owner sign-in and actual SMTP delivery after secrets and deployment are configured.

## Shared role password handover

Deploy `supabase/functions/role-password/index.ts` as `role-password`. Its handler verifies the bearer token, the database Owner role and organization, the configured owner identity, and the current Owner password before any account mutation. The config disables the legacy JWT gateway because verification occurs in the handler. Never deploy a version without these checks.

Owner login uses the existing owner account password until changed. In Owner Settings → Access Passcodes, enter the current Owner password, the new role password, and its confirmation. Saving Staff or View provisions that shared role account if absent. Provision Staff and View first, then change Owner. Passwords are never embedded in the frontend or committed to source. Initial handover values are entered by the administrator directly in the UI.

The shared identities are `oneledger-staff@accounts.invalid` and `oneledger-view@accounts.invalid`; these are internal identifiers, not email delivery addresses. Everyone using a role shares its audit identity. Password changes affect future sign-ins; existing sessions are not immediately revoked and may remain active until session expiry. This is a single-organization setup.

Validation: four mocked cloud browser tests and five server authorization tests cover the role UI, owner password submission, unlinked-user denial, anonymous/Staff denial, Owner reauthentication, and fixed target identity. Real password provisioning and live role sign-in still require administrator completion.

## Cloudinary account (2026-10-06)

Cloudinary replaces the previously planned Cloudflare integration. Cloud name: `bowzvcvg`. Supplied preset: `ml_default`.

Verified in the Cloudinary dashboard: `ml_default` is **Signed**, uses filenames, disables unique filenames, and permits overwrite. The existing browser adapter sends unsigned uploads, so it is not compatible with this preset yet. Do not activate these values in Netlify until the upload approach is resolved. Keep the existing default preset unchanged.

Pending choice: add authenticated server-side signing (API secret stays in server secrets), or create a dedicated unsigned preset for the existing adapter. Receipt uploads should use unique names to avoid overwriting earlier images. No image upload has been tested against this account and no Cloudinary API secret has been supplied.

All integration work remains on `fix/role-login-cloudflare` despite its historical name. Development pushes skip Netlify deployments.
