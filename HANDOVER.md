# OneLedger Pro — service setup handover

This is a local development baseline. No production deployment, database, image account, cron job, or email sender has been connected by this import.

## GitHub

Destination: https://github.com/svkatabook-stack/OneledgerPro

The import uses a fresh Git history so old production configuration is not present in previous commits. The original checkout is preserved separately.

## Supabase — after account creation

1. Create a new project and retain its database password privately.
2. Configure the project's URL and public browser key in local/deployment environment variables when cloud integration work begins.
3. Review authentication, RLS, transaction identity, synchronization, and deletion before using the inherited SQL with real data.
4. Replace placeholder seed emails with the new users. Do not recreate the old shared-password login.
5. Supply the missing deletion RPC and configure Realtime as part of that work.
6. Rehearse with disposable data before migrating any ledger.

The scripts in `supabase/` preserve the original schema and report implementation for continued development; they are not a complete production provisioning workflow.

## Netlify — after account creation

Connect the GitHub repository. Build command: `npm run build`. Publish directory: `dist`. Node version: 22. SPA routing is already configured in `netlify.toml`.

No external credentials are embedded in that file. Keep the app in local mode until the backend is ready. A hosted local-mode demo still stores each browser's ledger separately; it does not create a shared database.

## Cloudflare — after account creation

Choose Cloudflare Images or R2 when storage requirements are clear. The upload backend and authorization will need to be implemented. Account creation alone does not enable uploads.

The inherited Cloudinary adapter is retained but unconfigured. All current attachments are compressed and stored in the local browser.

## Gmail reports — after account creation

Planned sender: `s.vkatabook@gmail.com`.

Configure server-side secrets only:

- `GMAIL_USER`: `s.vkatabook@gmail.com`
- `GMAIL_PASS`: Gmail app password after enabling 2-Step Verification
- `REPORT_TO`: intended recipient address; still to be decided
- `CRON_SECRET`: new random secret

Never put a Gmail password, app password, service-role key, or Cloudflare API token into a `VITE_*` variable or a committed file. Use the Supabase secret manager when deploying the reporting function.

`supabase/functions/.env.example` documents these names without credentials. Review and deploy the report function, then configure and test the cron templates. No emails are sent by running the local frontend.

## Local data

Use one consistent origin, http://127.0.0.1:5173, to see the same browser data across sessions. Settings offers Excel export. Local demo records are not automatically uploaded into a future cloud project.
