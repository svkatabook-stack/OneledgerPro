# OneLedger Pro handover

See [Cloud setup](docs/CLOUD_SETUP.md) for the tested database schema, owner creation, Netlify variables, Gmail secrets, and report deployment steps.

- Supabase project: `zlcittlgjvsiwstkhjvv`.
- Owner / report sender / recipient: `s.vkatabook@gmail.com`.
- Netlify: https://comfy-klepon-85d3fc.netlify.app (rename planned).
- GitHub: https://github.com/svkatabook-stack/OneledgerPro.
- Cloudflare images: not connected; the existing image adapter is still pending replacement.
- Local mode remains available without external accounts.

Never commit database passwords, Gmail app passwords, cron secrets, or service-role keys. Browser publishable keys identify the project; authorization comes from Supabase Auth and RLS.

## Branch workflow (2026-10-06)

- Active integration branch: `fix/role-login-cloudflare`.
- Keep role login, initial-role provisioning, Owner password settings, and upcoming Cloudflare image integration on this branch until reviewed.
- Do not push feature changes directly to `main` or trigger deployments while setup is ongoing.
- Use `[skip netlify]` on the latest commit of development pushes to suppress automatic branch builds. Branch deployments also consume build resources; enabling them is not a credit-saving mechanism by itself.
- User will enable the chosen branch in Netlify when ready to test. Deploy deliberately after the backend and configuration are ready.
- Role login/password-management implementation is tested but not live. Initial role passwords have not been set, and the `role-password` function is not deployed.
- Cloudflare image implementation is pending account setup and selection/configuration of the storage service. Keep credentials out of Git.
