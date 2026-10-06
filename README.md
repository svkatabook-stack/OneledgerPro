# OneLedger Pro

A customer ledger for cash, gold, silver, and chit transactions. This repository is a fresh, rebranded baseline of the existing application, with local demo mode and a separately authenticated Supabase cloud mode.

## Run locally

Use Node.js 22.12+ and npm:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. No `.env` file or external account is required. For optional configuration, copy `.env.example` to `.env.local`.

| Role | Local demo passcode |
|---|---|
| Owner | `owner-local` |
| Staff | `staff-local` |
| View | `view-local` |

These are demonstration passcodes, not production authentication. The inherited role restrictions still require review.

Start with Customers to create a customer, or use Settings → Load Dummy Data to load 15 sample customers and 39 transactions. Loading sample data replaces the current local ledger; export anything you want to keep first.

## Available locally

- Customer creation, searching, editing, and balances.
- Retail, Bullion, Silver, and Chit transaction entry.
- Jama / You Got and Nave / You Gave, with separate category balances.
- Receipt photos stored locally, printable receipts, and optional manual sharing.
- Ledger filtering, customer statements, deletion history, and due dates.
- Excel and CSV exports.
- Browser persistence across reloads.

Data lives in this browser's localStorage, using `oneledger_` keys. Other browsers/devices and other origins have separate data. Clearing browser storage removes this data. Photo attachments also consume browser storage. Automatic cloud sync and scheduled email are not active in this baseline.

WhatsApp and the browser Share button are explicit user actions and may open external apps. Local app loading, sign-in, ledger operations, and photos need no external service.

## Commands

```sh
npm run dev       # Local development on 127.0.0.1:5173
npm run build     # Production bundle in dist/
npm run preview   # Preview the production bundle
npm run lint      # Existing lint rules; inherited issues remain
npm run test:smoke # Local browser smoke checks (requires Google Chrome)
npm run test:cloud # Mocked cloud authentication/write checks
npm run test:reports # Report calendar-period checks
```

## Verification of this baseline

- Production build passed.
- Five Playwright smoke tests passed in an isolated Chrome profile: all three demo logins, customer creation, all eight category balances, an outgoing cash entry, local photo compression, reload persistence, page navigation, Excel download, and sample-data loading.
- The main local workflow made no external HTTP requests.
- Lint currently reports 19 errors and 4 warnings, including inherited issues and shared-export/hook warnings in the cloud integration. The lint check is not passing.

## New integrations — pending

| Service | Planned use | Status |
|---|---|---|
| GitHub | svkatabook-stack/OneledgerPro | Source repository |
| Supabase | Authentication, database, realtime, report function | Implementation ready; provisioning tracked in setup guide |
| Netlify | Website hosting | Site deployed; cloud activation pending |
| Cloudflare | Images/storage | Adapter not implemented; local photos work |
| Gmail | Send alerts from `s.vkatabook@gmail.com` | Not connected; recipient: `s.vkatabook@gmail.com` |

`VITE_APP_MODE` defaults to `local`. Switch to `cloud` only after applying the new schema and creating/linking the owner as described in [Cloud setup](docs/CLOUD_SETUP.md). The old deployment's account credentials, project identifiers, upload settings, customer-specific dashboard accounts, and Git history were not imported. Cloud access uses shared Owner, Staff, and View passwords managed by the Owner; see the setup guide for provisioning.

Cloud mode uses private, server-signed Cloudinary receipt uploads. Local mode keeps photos in browser storage. See [Cloudinary setup](docs/CLOUDINARY_SETUP.md) for credentials and activation.

See [HANDOVER.md](HANDOVER.md) for the setup checklist and [docs/BASELINE.md](docs/BASELINE.md) for the boundary of this import and deferred work.

## Code map

- `src/context/AppContext.jsx`: local ledger state and preserved legacy synchronization code.
- `src/context/CloudAppProvider.jsx`: authenticated cloud state, paginated reads, and confirmed database writes.
- `src/pages/`: login, dashboard, customers, transaction entry, ledger, dues, settings.
- `src/components/`: receipts, UI primitives, and preserved legacy entry components.
- `src/lib/runtime.js`: explicit local mode and demo passcodes.
- `src/lib/supabase.js`: isolated Supabase client configuration.
- `src/utils/imageUtils.js` and `src/workers/`: receipt-image compression and storage adapter.
- `supabase/`: new database schema, owner seed, permission tests, email function, and cron setup.
