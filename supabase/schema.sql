-- OneLedger Pro: fresh-project schema. Apply once, inside a transaction.
-- Owner linking is a separate administrator-only step in seed.sql.
begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create table if not exists public.organizations (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    created_at timestamptz default now()
);

-- ── 2. User Profiles (extends auth.users with role + org) ────────────────────
create table if not exists public.profiles (
    id           uuid primary key references auth.users(id) on delete cascade,
    org_id       uuid references public.organizations(id),
    role         text check (role in ('owner', 'staff', 'view')) default 'view',
    display_name text,
    created_at   timestamptz default now()
);

-- ── 3. Customers ─────────────────────────────────────────────────────────────
create table if not exists public.customers (
    id               uuid primary key default gen_random_uuid(),
    org_id           uuid not null references public.organizations(id),
    name             text not null,
    mobile           text not null,
    mobile2          text,
    tag              text default '',
    primary_category text default 'CASH',
    due_date         date,

    -- Per-category isolated balances (cash = ₹, gold/silver = grams)
    retail_cash     numeric(15,2) not null default 0,
    retail_gold     numeric(15,3) not null default 0,
    bullion_cash    numeric(15,2) not null default 0,
    bullion_gold    numeric(15,3) not null default 0,
    bullion_silver  numeric(15,3) not null default 0,
    silver_cash     numeric(15,2) not null default 0,
    silver_silver   numeric(15,3) not null default 0,
    chit_cash       numeric(15,2) not null default 0,

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
    jama            numeric(15,3) not null default 0,   -- shop received
    nave            numeric(15,3) not null default 0,   -- shop gave
    grams           numeric(15,3) not null default 0,
    bill_amount     numeric(15,2) not null default 0,
    chit_scheme     text default '',
    description     text default '',
    date            date not null,
    time            time not null,
    added_by        text,
    images          jsonb default '[]',
    current_balance numeric(15,3) not null default 0,
    new_balance     numeric(15,3) not null default 0,
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


create unique index if not exists customers_org_mobile on public.customers(org_id, mobile);
create index if not exists transactions_org_date on public.transactions(org_id,date,time,id);
create index if not exists transactions_customer on public.transactions(customer_id);
alter table public.transactions add constraint transaction_positive_side check (
    (jama > 0 and nave = 0) or (nave > 0 and jama = 0)
);
alter table public.transactions add constraint transaction_asset_category check (
    (category='RETAIL' and type in ('CASH','GOLD')) or
    (category='BULLION' and type in ('CASH','GOLD','SILVER')) or
    (category='SILVER' and type in ('CASH','SILVER')) or
    (category='CHIT' and type='CASH')
);

create table public.report_runs (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id),
    report_type text not null check (report_type in ('daily','weekly')),
    date_from date not null,
    date_to date not null,
    status text not null default 'sending' check (status in ('sending','sent','failed')),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    error text,
    unique(org_id, report_type, date_from, date_to)
);

create or replace function private.org_id() returns uuid
language sql stable security definer set search_path='' as $$
 select org_id from public.profiles where id=auth.uid()
$$;
create or replace function private.user_role() returns text
language sql stable security definer set search_path='' as $$
 select role from public.profiles where id=auth.uid()
$$;
revoke all on function private.org_id(), private.user_role() from public;
grant execute on function private.org_id(), private.user_role() to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,role,display_name)
 values(new.id,'view',coalesce(new.raw_user_meta_data->>'display_name','User'))
 on conflict(id) do nothing;
 return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
 for each row execute function public.handle_new_user();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.transactions enable row level security;
alter table public.chit_schemes enable row level security;
alter table public.report_runs enable row level security;

-- Grants and RLS both apply. No client can write roles or balance columns.
revoke all on public.organizations,public.profiles,public.customers,
 public.transactions,public.chit_schemes,public.report_runs from anon,authenticated;
grant select on public.organizations,public.profiles,public.customers,
 public.transactions,public.chit_schemes,public.report_runs to authenticated;
grant insert(id,org_id,name,mobile,mobile2,tag,primary_category,due_date) on public.customers to authenticated;
grant update(name,mobile,mobile2,tag,primary_category,due_date) on public.customers to authenticated;
grant insert(org_id,name) on public.chit_schemes to authenticated;
grant delete on public.chit_schemes to authenticated;
grant all on public.organizations,public.profiles,public.customers,
 public.transactions,public.chit_schemes,public.report_runs to service_role;

create policy org_read on public.organizations for select to authenticated using(id=private.org_id());
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or org_id=private.org_id());
create policy customer_read on public.customers for select to authenticated using(org_id=private.org_id());
create policy customer_insert on public.customers for insert to authenticated
 with check(org_id=private.org_id() and private.user_role() in ('owner','staff'));
create policy customer_update on public.customers for update to authenticated
 using(org_id=private.org_id() and private.user_role() in ('owner','staff'))
 with check(org_id=private.org_id() and private.user_role() in ('owner','staff'));
create policy transaction_read on public.transactions for select to authenticated using(org_id=private.org_id());
create policy scheme_read on public.chit_schemes for select to authenticated using(org_id=private.org_id());
create policy scheme_insert on public.chit_schemes for insert to authenticated
 with check(org_id=private.org_id() and private.user_role() in ('owner','staff'));
create policy scheme_delete on public.chit_schemes for delete to authenticated
 using(org_id=private.org_id() and private.user_role()='owner' and not is_default);
create policy report_read on public.report_runs for select to authenticated
 using(org_id=private.org_id() and private.user_role()='owner');

create or replace function private.balance_column(category text, asset text) returns text
language sql immutable set search_path='' as $$
 select case category || ':' || asset
 when 'RETAIL:CASH' then 'retail_cash' when 'RETAIL:GOLD' then 'retail_gold'
 when 'BULLION:CASH' then 'bullion_cash' when 'BULLION:GOLD' then 'bullion_gold'
 when 'BULLION:SILVER' then 'bullion_silver' when 'SILVER:CASH' then 'silver_cash'
 when 'SILVER:SILVER' then 'silver_silver' when 'CHIT:CASH' then 'chit_cash' end
$$;
revoke all on function private.balance_column(text,text) from public,anon,authenticated;

-- A client UUID is reused on retries. The server computes balances under a row lock.
create or replace function public.record_transaction(p_id uuid,p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_org uuid := private.org_id(); v_customer public.customers; v_tx public.transactions;
 v_category text := p_entry->>'category'; v_type text := p_entry->>'type';
 v_column text := private.balance_column(v_category,v_type);
 v_jama numeric := coalesce((p_entry->>'jama')::numeric,0);
 v_nave numeric := coalesce((p_entry->>'nave')::numeric,0);
 v_before numeric; v_after numeric; v_sub text;
begin
 if auth.uid() is null or v_org is null or private.user_role() not in ('owner','staff') then
  raise exception 'Write access required' using errcode='42501';
 end if;
 if p_id is null or v_column is null or not ((v_jama>0 and v_nave=0) or (v_nave>0 and v_jama=0))
 or v_jama::text in ('NaN','Infinity','-Infinity') or v_nave::text in ('NaN','Infinity','-Infinity') then
  raise exception 'Invalid transaction';
 end if;
 if v_jama != round(v_jama,case when v_type='CASH' then 2 else 3 end)
 or v_nave != round(v_nave,case when v_type='CASH' then 2 else 3 end) then
  raise exception 'Cash allows 2 decimal places; metal allows 3';
 end if;
 select * into v_customer from public.customers
 where id=(p_entry->>'customerId')::uuid and org_id=v_org for update;
 if not found then raise exception 'Customer not found' using errcode='42501'; end if;
 select * into v_tx from public.transactions where id=p_id;
 if found then
  if v_tx.org_id!=v_org or v_tx.customer_id!=v_customer.id or v_tx.category!=v_category
  or v_tx.type!=v_type or v_tx.jama!=v_jama or v_tx.nave!=v_nave or v_tx.deleted_at is not null then
   raise exception 'Transaction identifier already used';
  end if;
  return to_jsonb(v_tx);
 end if;
 if v_category='CHIT' and not exists(select 1 from public.chit_schemes where org_id=v_org and name=p_entry->>'chit_scheme') then
  raise exception 'Select a valid chit scheme';
 end if;
 if jsonb_typeof(coalesce(p_entry->'images','[]'::jsonb)) != 'array'
 or octet_length(coalesce(p_entry->'images','[]'::jsonb)::text)>1500000 then
  raise exception 'Receipt attachments are too large';
 end if;
 v_before := (to_jsonb(v_customer)->>v_column)::numeric;
 v_after := v_before+v_jama-v_nave;
 v_sub := case when v_category='RETAIL' and v_type='GOLD' then 'METAL' else v_type end;
 insert into public.transactions(id,org_id,customer_id,category,sub_type,type,direction,jama,nave,
 grams,bill_amount,chit_scheme,description,date,time,added_by,images,current_balance,new_balance,due_date)
 values(p_id,v_org,v_customer.id,v_category,v_sub,v_type,case when v_jama>0 then 'IN' else 'OUT' end,
 v_jama,v_nave,case when v_type='CASH' then 0 else v_jama+v_nave end,
 coalesce((p_entry->>'bill_amount')::numeric,0),coalesce(p_entry->>'chit_scheme',''),
 coalesce(p_entry->>'description',''),(p_entry->>'date')::date,(p_entry->>'time')::time,
 auth.uid()::text,coalesce(p_entry->'images','[]'::jsonb),v_before,v_after,nullif(p_entry->>'due_date','')::date)
 returning * into v_tx;
 execute format('update public.customers set %I=$1, updated_at=now(), due_date=coalesce($2,due_date) where id=$3',v_column)
 using v_after,v_tx.due_date,v_customer.id;
 return to_jsonb(v_tx);
end;
$$;
revoke all on function public.record_transaction(uuid,jsonb) from public,anon;
grant execute on function public.record_transaction(uuid,jsonb) to authenticated;

create or replace function public.delete_transaction(p_transaction_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_tx public.transactions; v_column text;
begin
 if auth.uid() is null or private.user_role() is distinct from 'owner' then
  raise exception 'Owner access required' using errcode='42501';
 end if;
 select * into v_tx from public.transactions where id=p_transaction_id and org_id=private.org_id() for update;
 if not found then raise exception 'Transaction not found'; end if;
 if v_tx.deleted_at is not null then return; end if;
 v_column := private.balance_column(v_tx.category,v_tx.type);
 execute format('update public.customers set %I=%I+$1, updated_at=now() where id=$2',v_column,v_column)
 using v_tx.nave-v_tx.jama,v_tx.customer_id;
 update public.transactions set deleted_at=now() where id=v_tx.id;
end;
$$;
revoke all on function public.delete_transaction(uuid) from public,anon;
grant execute on function public.delete_transaction(uuid) to authenticated;

-- Enable realtime for only these application tables.
do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['customers','transactions','chit_schemes'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
commit;

-- Subsequent migrations included for fresh installations.
begin;
lock table public.transactions in share row exclusive mode;
alter table public.transactions add column bill_number text;
-- Preserve any existing entries, assigning chronological numbers within each ledger.
with numbered as (
 select id, row_number() over(partition by org_id order by created_at,id) as n
 from public.transactions
)
update public.transactions t set bill_number='OLP-' || lpad(n.n::text,greatest(6,length(n.n::text)),'0')
from numbered n where n.id=t.id;
alter table public.transactions alter column bill_number set not null;
alter table public.transactions add constraint transactions_org_bill_unique unique(org_id,bill_number);
create table private.bill_counters (
 org_id uuid primary key references public.organizations(id),
 last_number bigint not null check(last_number>0)
);
revoke all on private.bill_counters from public,anon,authenticated;
insert into private.bill_counters select org_id,count(*) from public.transactions group by org_id;
create function private.assign_bill_number() returns trigger
language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
 insert into private.bill_counters(org_id,last_number) values(new.org_id,1)
 on conflict(org_id) do update set last_number=private.bill_counters.last_number+1
 returning last_number into n;
 new.bill_number := 'OLP-' || lpad(n::text,greatest(6,length(n::text)),'0');
 return new;
end;
$$;
revoke all on function private.assign_bill_number() from public,anon,authenticated;
create trigger assign_bill_number before insert on public.transactions
 for each row execute function private.assign_bill_number();
commit;

-- Preserve the established 24-hour Staff/View history rule at the database boundary.
begin;
drop policy transaction_read on public.transactions;
create policy transaction_read on public.transactions for select to authenticated
using(org_id=private.org_id() and (
 private.user_role()='owner' or
 (private.user_role() in ('staff','view') and deleted_at is null and created_at >= now()-interval '24 hours')
));
commit;
