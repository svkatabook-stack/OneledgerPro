-- ═══════════════════════════════════════════════════════════
--  OneLedger Pro — Seed Script
--  Run AFTER:
--    1. schema.sql has been executed
--    2. You created users in Supabase Auth → Users:
--       owner@example.invalid  (strong password)
--       staff@example.invalid  (strong password)
--  Replace example.invalid emails with your new users before using this legacy seed.
-- ═══════════════════════════════════════════════════════════

-- 1. Create the organisation
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'OneLedger Pro')
on conflict do nothing;

-- 2. Link users to the org with roles
--    Uses UPSERT so it works whether or not the trigger already created the profile row
--    ⚠️  Configure new auth users first; this script is not needed for local mode.
insert into public.profiles (id, org_id, role, display_name)
select id, '00000000-0000-0000-0000-000000000001'::uuid, 'owner', 'Owner' from auth.users where email = 'owner@example.invalid'
on conflict (id) do update
    set org_id = excluded.org_id,
        role   = excluded.role,
        display_name = excluded.display_name;

insert into public.profiles (id, org_id, role, display_name)
select id, '00000000-0000-0000-0000-000000000001'::uuid, 'staff', 'Staff' from auth.users where email = 'staff@example.invalid'
on conflict (id) do update
    set org_id = excluded.org_id,
        role   = excluded.role,
        display_name = excluded.display_name;

-- 3. Seed default chit schemes
insert into public.chit_schemes (org_id, name, is_default) values
    ('00000000-0000-0000-0000-000000000001', 'CHIT',           true),
    ('00000000-0000-0000-0000-000000000001', 'DIWALI FUND',    true),
    ('00000000-0000-0000-0000-000000000001', 'GOLD SCHEME',    true),
    ('00000000-0000-0000-0000-000000000001', 'SILVER SCHEME',  true),
    ('00000000-0000-0000-0000-000000000001', 'MONTHLY SCHEME', true)
on conflict do nothing;
