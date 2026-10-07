# Import boundary and deferred work

## Changes in this baseline

- Rebrand screens, receipt text, report text, exports, package metadata, page title, and PWA manifest to OneLedger Pro.
- Use a fresh repository without the previous deployment's Git history.
- Remove production URLs/keys, fixed Supabase user UUIDs, old passcode hashes/passwords, sender addresses, and shop-specific dashboard account names.
- Preserve the application's frontend, styles, SQL templates, reporting function, and legacy entry components.
- Default to local mode, local demo passcodes, browser-only photos, and separate browser-storage keys.
- Avoid Supabase token restoration and network sign-out in local mode.
- Supply credential-free deployment templates and future service setup notes.
- Fix the missing Button import and conditional-hook ordering in customer history so basic local navigation is usable.

## Deferred from the repository review

This import does not resolve the larger audit findings:

- Cloud authentication and server-side role/organization enforcement.
- Optimistic transaction IDs, RPC response handling, realtime deduplication, and reliable write acknowledgement.
- Incremental sync watermarks, reconnect recovery, and a durable offline write queue.
- Missing deletion RPC and complete reproducible database migrations.
- Concurrent before/after balance snapshots and opening-balance persistence.
- Consistent unit handling, precision, Jama/Nave labels, and running balances across older screens.
- Legacy global-export classification and export completeness.
- Secondary-mobile mapping and cloud scheme synchronization.
- Timezone handling, report boundaries, pagination, error handling, and email retry behavior.
- Centralized role guards, data lifecycle controls, and broader automated coverage.

Cloud sign-in is deliberately unavailable until the new authentication integration is implemented. Local role selection is for demonstration and does not enforce production access control.

## Validation on 3 October 2026

`npm run build`: passed. `npm run test:smoke`: 5 passed. Local workflow tests assert category and aggregate balances, photo storage, reload persistence, export download, and no external HTTP requests. `npm run lint`: 16 errors and 3 warnings remain from inherited patterns; this is not a production-hardening release.

## Subsequent cloud foundation

The original import boundary above is historical. The cloud implementation now uses a separate provider, real Supabase email/password sign-in, confirmed writes, and a tested fresh-project RLS schema with atomic transaction/delete RPCs. See CLOUD_SETUP.md. The legacy AppContext remains the local/demo provider; its old cloud code is not used by cloud mode. This paragraph is historical. Cloudinary storage is now implemented; see CLOUDINARY_SETUP.md and RELEASE_20261007.md for current status.
