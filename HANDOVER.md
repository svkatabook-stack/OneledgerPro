# OneLedger Pro handover

See [Cloud setup](docs/CLOUD_SETUP.md) for the tested database schema, owner creation, Netlify variables, Gmail secrets, and report deployment steps.

- Supabase project: `zlcittlgjvsiwstkhjvv`.
- Owner / report sender / recipient: `s.vkatabook@gmail.com`.
- Netlify: https://comfy-klepon-85d3fc.netlify.app (rename planned).
- GitHub: https://github.com/svkatabook-stack/OneledgerPro.
- Cloudflare images: not connected; the existing image adapter is still pending replacement.
- Local mode remains available without external accounts.

Never commit database passwords, Gmail app passwords, cron secrets, or service-role keys. Browser publishable keys identify the project; authorization comes from Supabase Auth and RLS.
