-- ═══════════════════════════════════════════════════════════════════════
--  OneLedger Pro — Scheduled Email Reports via pg_cron + pg_net
--
--  BEFORE RUNNING:
--  1. Enable pg_net extension in Supabase Dashboard → Database → Extensions
--  2. Replace <YOUR_SUPABASE_URL>  with your project URL
--     e.g. https://abcdefghijkl.supabase.co
--  3. Replace <YOUR_ANON_KEY> with your project anon key
--  4. Replace <YOUR_CRON_SECRET> with the same value you added
--     as CRON_SECRET in Edge Function secrets
--  5. Run this entire file in Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- Enable required extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── PRODUCTION: Daily report at 23:45 IST every day (18:15 UTC) ─────────
select cron.schedule(
    'daily-report',
    '15 18 * * *',  -- 18:15 UTC = 23:45 IST
    $$
    select net.http_post(
        url     := '<YOUR_SUPABASE_URL>/functions/v1/send-report?type=daily',
        headers := jsonb_build_object(
            'Content-Type',    'application/json',
            'Authorization',   'Bearer <YOUR_ANON_KEY>',
            'x-cron-secret',   '<YOUR_CRON_SECRET>'
        ),
        body    := '{}'::jsonb
    );
    $$
);

-- ── PRODUCTION: Weekly report Sunday 8:00 AM IST (Sunday 02:30 UTC) ───
select cron.schedule(
    'weekly-report',
    '30 2 * * 0',   -- 02:30 UTC Sunday = 08:00 IST Sunday
    $$
    select net.http_post(
        url     := '<YOUR_SUPABASE_URL>/functions/v1/send-report?type=weekly',
        headers := jsonb_build_object(
            'Content-Type',    'application/json',
            'Authorization',   'Bearer <YOUR_ANON_KEY>',
            'x-cron-secret',   '<YOUR_CRON_SECRET>'
        ),
        body    := '{}'::jsonb
    );
    $$
);

-- ── Verify schedules are registered ─────────────────────────────────────
select jobname, schedule, active from cron.job order by jobname;
