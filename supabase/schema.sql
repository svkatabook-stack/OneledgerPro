-- ═══════════════════════════════════════════════════════════
--  OneLedger Pro — Supabase Schema
--  Run this entire file in Supabase → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════

-- ── 1. Organizations (one row per shop) ──────────────────────────────────────
create table if not exists public.organizations (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    created_at timestamptz default now()
);

-- ── 2. User Profiles (extends auth.users with role + org) ────────────────────
create table if not exists public.profiles (
    id           uuid primary key references auth.users(id) on delete cascade,
    org_id       uuid references public.organizations(id),
    role         text check (role in ('owner', 'staff', 'view')) default 'staff',
    display_name text,
    created_at   timestamptz default now()
);

-- Auto-create profile row when a new auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id, display_name)
    values (new.id, new.raw_user_meta_data->>'display_name');
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- ── 3. Customers ─────────────────────────────────────────────────────────────
create table if not exists public.customers (
    id               uuid primary key default gen_random_uuid(),
    org_id           uuid not null references public.organizations(id),
    name             text not null,
    mobile           text not null,
    mobile2          text,
    primary_category text default 'CASH',
    due_date         date,

    -- Per-category isolated balances (cash = ₹, gold/silver = grams)
    retail_cash     numeric(15,2) default 0,
    retail_gold     numeric(15,3) default 0,
    bullion_cash    numeric(15,2) default 0,
    bullion_gold    numeric(15,3) default 0,
    bullion_silver  numeric(15,3) default 0,
    silver_cash     numeric(15,2) default 0,
    silver_silver   numeric(15,3) default 0,
    chit_cash       numeric(15,2) default 0,

    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- ── 4. Transactions (append-only ledger) ─────────────────────────────────────
create table if not exists public.transactions (
    id              uuid primary key default gen_random_uuid(),
    org_id          uuid not null references public.organizations(id),
    customer_id     uuid not null references public.customers(id),
    category        text not null check (category in ('RETAIL','BULLION','SILVER','CHIT')),
    sub_type        text not null,
    type            text not null check (type in ('CASH','GOLD','SILVER')),
    direction       text not null check (direction in ('IN','OUT')),
    jama            numeric(15,3) default 0,   -- shop received
    nave            numeric(15,3) default 0,   -- shop gave
    grams           numeric(15,3) default 0,
    bill_amount     numeric(15,2) default 0,
    chit_scheme     text default '',
    description     text default '',
    date            date not null,
    time            time not null,
    added_by        text,
    images          jsonb default '[]',
    current_balance numeric(15,3) default 0,
    new_balance     numeric(15,3) default 0,
    whatsapp_sent   boolean default false,
    due_date        date,                       -- optional per-transaction due date
    deleted_at      timestamptz,               -- soft delete
    created_at      timestamptz default now()
);

-- ── 5. Chit Schemes ───────────────────────────────────────────────────────────
create table if not exists public.chit_schemes (
    id         uuid primary key default gen_random_uuid(),
    org_id     uuid not null references public.organizations(id),
    name       text not null,
    is_default boolean default false,
    created_at timestamptz default now(),
    unique(org_id, name)
);

-- ── 6. Row Level Security ─────────────────────────────────────────────────────
alter table public.customers     enable row level security;
alter table public.transactions  enable row level security;
alter table public.chit_schemes  enable row level security;
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;

-- Helper: get the calling user's org_id
create or replace function public.get_user_org_id()
returns uuid language sql security definer set search_path = public as $$
    select org_id from public.profiles where id = auth.uid();
$$;

-- Helper: get the calling user's role
create or replace function public.get_user_role()
returns text language sql security definer set search_path = public as $$
    select role from public.profiles where id = auth.uid();
$$;

-- Customers
drop policy if exists "select own org" on public.customers;
drop policy if exists "insert own org" on public.customers;
drop policy if exists "update own org" on public.customers;
drop policy if exists "owner delete"   on public.customers;
create policy "select own org" on public.customers for select using (org_id = get_user_org_id());
create policy "insert own org" on public.customers for insert with check (org_id = get_user_org_id());
create policy "update own org" on public.customers for update using (org_id = get_user_org_id());
create policy "owner delete"   on public.customers for delete using (org_id = get_user_org_id() and get_user_role() = 'owner');

-- Transactions
drop policy if exists "select own org" on public.transactions;
drop policy if exists "insert own org" on public.transactions;
drop policy if exists "owner delete"   on public.transactions;
create policy "select own org" on public.transactions for select using (org_id = get_user_org_id());
create policy "insert own org" on public.transactions for insert with check (org_id = get_user_org_id());
create policy "owner delete"   on public.transactions for delete using (org_id = get_user_org_id() and get_user_role() = 'owner');

-- Chit schemes
drop policy if exists "select own org" on public.chit_schemes;
drop policy if exists "insert own org" on public.chit_schemes;
drop policy if exists "owner delete"   on public.chit_schemes;
create policy "select own org" on public.chit_schemes for select using (org_id = get_user_org_id());
create policy "insert own org" on public.chit_schemes for insert with check (org_id = get_user_org_id());
create policy "owner delete"   on public.chit_schemes for delete using (org_id = get_user_org_id() and get_user_role() = 'owner');

-- Organizations
drop policy if exists "Allow select for everyone" on public.organizations;
create policy "Allow select for everyone" on public.organizations for select using (true);

drop policy if exists "Allow owners to update org" on public.organizations;
create policy "Allow owners to update org" on public.organizations for update using (get_user_role() = 'owner');

-- Profiles
drop policy if exists "Allow select profiles in same org" on public.profiles;
create policy "Allow select profiles in same org" on public.profiles for select using (org_id = get_user_org_id());

drop policy if exists "Allow users to update own profile" on public.profiles;
create policy "Allow users to update own profile" on public.profiles for update using (auth.uid() = id);

-- ── 7. Atomic add_transaction function ───────────────────────────────────────
-- Inserts transaction AND updates the matching customer balance in one DB call
create or replace function public.add_transaction(
    p_org_id         uuid,
    p_customer_id    uuid,
    p_category       text,
    p_sub_type       text,
    p_type           text,
    p_jama           numeric,
    p_nave           numeric,
    p_grams          numeric,
    p_bill_amount    numeric,
    p_chit_scheme    text,
    p_description    text,
    p_date           date,
    p_time           text,
    p_added_by       text,
    p_images         jsonb,
    p_current_bal    numeric,
    p_new_bal        numeric,
    p_due_date       date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
    v_id    uuid;
    v_delta numeric := p_jama - p_nave;
begin
    -- 1. Insert the transaction row
    insert into public.transactions (
        org_id, customer_id, category, sub_type, type, direction,
        jama, nave, grams, bill_amount, chit_scheme, description,
        date, time, added_by, images, current_balance, new_balance, due_date
    ) values (
        p_org_id, p_customer_id, p_category, p_sub_type, p_type,
        case when p_jama > 0 then 'IN' else 'OUT' end,
        p_jama, p_nave, p_grams, p_bill_amount, p_chit_scheme, p_description,
        p_date, p_time::time, p_added_by, p_images,
        p_current_bal, p_new_bal, p_due_date
    ) returning id into v_id;

    -- 2. Update the correct per-category balance column atomically
    case
        when p_category = 'RETAIL'  and p_type = 'CASH'   then update public.customers set retail_cash    = retail_cash    + v_delta, updated_at = now() where id = p_customer_id;
        when p_category = 'RETAIL'  and p_type = 'GOLD'   then update public.customers set retail_gold    = retail_gold    + v_delta, updated_at = now() where id = p_customer_id;
        when p_category = 'BULLION' and p_type = 'CASH'   then update public.customers set bullion_cash   = bullion_cash   + v_delta, updated_at = now() where id = p_customer_id;
        when p_category = 'BULLION' and p_type = 'GOLD'   then update public.customers set bullion_gold   = bullion_gold   + v_delta, updated_at = now() where id = p_customer_id;
        when p_category = 'BULLION' and p_type = 'SILVER' then update public.customers set bullion_silver = bullion_silver + v_delta, updated_at = now() where id = p_customer_id;
        when p_category = 'SILVER'  and p_type = 'CASH'   then update public.customers set silver_cash    = silver_cash    + v_delta, updated_at = now() where id = p_customer_id;
        when p_category = 'SILVER'  and p_type = 'SILVER' then update public.customers set silver_silver  = silver_silver  + v_delta, updated_at = now() where id = p_customer_id;
        when p_category = 'CHIT'    and p_type = 'CASH'   then update public.customers set chit_cash      = chit_cash      + v_delta, updated_at = now() where id = p_customer_id;
        else null;
    end case;

    -- 3. Optionally update due_date on customer
    if p_due_date is not null then
        update public.customers set due_date = p_due_date where id = p_customer_id;
    end if;

    return v_id;
end;
$$;

-- ── 8. API permissions (grant access to authenticated/anon roles) ────────────
grant select, insert, update on public.profiles      to authenticated;
grant select, insert, update on public.customers     to authenticated;
grant select, insert, update on public.transactions  to authenticated;
grant select, insert, update on public.chit_schemes  to authenticated;
grant select, update         on public.organizations to authenticated;
grant select                 on public.profiles         to anon;

-- ── 9. Indexes for common queries ─────────────────────────────────────────────
create index if not exists idx_transactions_customer  on public.transactions(customer_id);
create index if not exists idx_transactions_org_date  on public.transactions(org_id, date desc);
create index if not exists idx_customers_org          on public.customers(org_id);
create index if not exists idx_customers_due_date     on public.customers(org_id, due_date) where due_date is not null;

-- ── 10. Passcode hashes (owner-managed, stored per org) ───────────────────────
-- Allows owner to change login passcodes from the app Settings without a code deploy.
-- Anon role needs SELECT so the login page can verify hashes before authentication.
alter table public.organizations
    add column if not exists passcode_owner_hash text,
    add column if not exists passcode_staff_hash  text,
    add column if not exists passcode_view_hash   text;

grant select on public.organizations to anon;

-- Passcode hashes are intentionally not seeded from the previous deployment.
-- Cloud authentication requires a separate setup/review before production use.

-- ── Done ──────────────────────────────────────────────────────────────────────
-- Next step: Go to Authentication → Users and create your users,
-- then run the seed below to set up your organization and link users.
