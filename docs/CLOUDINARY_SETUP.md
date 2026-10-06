# Private Cloudinary receipt setup

Cloud: `bowzvcvg`. Dedicated preset: `oneledger_receipts` (Signed, authenticated delivery,
overwrite disabled, WebP only). Leave `ml_default` unchanged.

## Enter credentials privately

1. Open Cloudinary Settings → API Keys:
   https://console.cloudinary.com/app/c-17dde0385ed48f4e27f7d4375531a3/settings/api-keys
2. Open Supabase → Edge Functions → Secrets:
   https://supabase.com/dashboard/project/zlcittlgjvsiwstkhjvv/functions/secrets
3. Add `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` with the corresponding Cloudinary values.
   Do not paste credentials into chat, source code, GitHub, or any `VITE_*` variable.
4. Existing server settings are `CLOUDINARY_CLOUD_NAME=bowzvcvg` and
   `CLOUDINARY_UPLOAD_PRESET=oneledger_receipts`.
5. Deploy `receipt-images` with `supabase functions deploy receipt-images --no-verify-jwt`.
   The function verifies the user's token itself with Supabase Auth and uses caller-scoped RLS queries.
6. Verify an Owner/Staff upload and authorized viewing, then deploy the feature branch to Netlify.
   Development commits use `[skip netlify]` until setup is complete. Main remains unchanged.

## Behavior

Cloud mode compresses photos to WebP (maximum 300 KB), then sends them through the authenticated
Edge Function. It uploads authenticated Cloudinary assets under server-generated UUID paths.
Only Owner and Staff may upload. The uploader can preview their own upload; other users need an
accessible saved transaction. View users always need an accessible transaction. Database reads
use the caller's token, retaining RLS. Only asset references are stored in new transactions.
The UI obtains five-minute download URLs and refreshes them while open. A copied temporary URL
can be used by anyone holding it until it expires; API secrets never reach the frontend.

Missing credentials produce an explicit setup error; cloud mode does not silently store inline
photos. Existing inline/public images remain supported and are not migrated or made private by
this change. Local mode retains browser-only photo storage. Abandoned uploads can remain in
Cloudinary; automatic orphan cleanup is not implemented. Credential rotation is performed in
Cloudinary and then updated in Supabase Secrets, without changing frontend code.

## Verification

Server tests: `npx --yes deno test --allow-env --allow-net supabase/functions/receipt-images/index.test.ts`
Browser tests: `npm run test:cloud` and `npm run test:smoke`.
Mock tests cover permission checks, signed upload parameters, reference-only persistence,
size/format rejection, private links and upload/reload rendering. They do not establish that
real Cloudinary credentials or delivery work; a live upload is required after adding secrets.

Deployment status (2026-10-06): `receipt-images` is deployed and rejects unauthenticated
requests with HTTP 401. Cloud name/preset settings are saved. API key/secret entry and
a live Cloudinary upload remain pending; frontend deployment is intentionally held.
