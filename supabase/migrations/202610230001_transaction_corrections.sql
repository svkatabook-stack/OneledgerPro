begin;
alter table public.transactions add column revision integer not null default 0;
create table public.transaction_corrections (
 id uuid primary key,
 org_id uuid not null references public.organizations(id),
 transaction_id uuid not null references public.transactions(id),
 actor_id uuid not null references auth.users(id),
 actor_label text not null,
 changed_at timestamptz not null default clock_timestamp(),
 reason text not null check(length(reason) between 1 and 500),
 before_values jsonb not null,
 after_values jsonb not null,
 revision integer not null,
 unique(transaction_id,revision)
);
create index on public.transaction_corrections(org_id,transaction_id,revision);
alter table public.transaction_corrections enable row level security;
revoke all on public.transaction_corrections from anon,authenticated;
grant select on public.transaction_corrections to authenticated;
create policy owner_correction_read on public.transaction_corrections for select to authenticated
 using(org_id=private.org_id() and private.user_role()='owner');

-- Rebuild only the affected account, preserving any balance outside active rows.
create function private.rebuild_running_balances(p_customer uuid,p_category text,p_type text) returns void
language plpgsql security definer set search_path='' as $$
declare v_base numeric; v_column text := private.balance_column(p_category,p_type);
begin
 execute format('select %I from public.customers where id=$1',v_column) into v_base using p_customer;
 select v_base-coalesce(sum(jama-nave),0) into v_base from public.transactions
 where customer_id=p_customer and category=p_category and type=p_type and deleted_at is null;
 with running as (
  select id,jama-nave as delta,v_base+sum(jama-nave) over(order by created_at,id) as balance
  from public.transactions where customer_id=p_customer and category=p_category and type=p_type and deleted_at is null
 ) update public.transactions t set current_balance=r.balance-r.delta,new_balance=r.balance
 from running r where t.id=r.id and (t.current_balance is distinct from r.balance-r.delta or t.new_balance is distinct from r.balance);
end $$;
revoke all on function private.rebuild_running_balances(uuid,text,text) from public,anon,authenticated;

create function public.edit_transaction(p_id uuid,p_expected_revision integer,p_change_id uuid,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_org uuid := private.org_id(); v_old public.transactions; v_new public.transactions;
 v_amount numeric := (p_changes->>'amount')::numeric;
 v_bill_amount numeric := coalesce(nullif(p_changes->>'bill_amount','')::numeric,0);
 v_bill text := nullif(upper(btrim(p_changes->>'bill_number')),'');
 v_reason text := btrim(p_changes->>'reason'); v_direction text := p_changes->>'direction';
 v_date date := (p_changes->>'date')::date; v_description text := coalesce(btrim(p_changes->>'description'),'');
 v_column text; v_delta numeric; v_before jsonb; v_after jsonb; v_actor text;
 v_fields text[] := array['jama','nave','direction','grams','bill_amount','bill_number','date','description'];
begin
 if auth.uid() is null or v_org is null or private.user_role() is distinct from 'owner' then
  raise exception 'Owner access required' using errcode='42501';
 end if;
 select * into v_old from public.transactions where id=p_id and org_id=v_org;
 if not found then raise exception 'Transaction not found' using errcode='42501'; end if;
 -- All writers lock the customer before a transaction, including delete below.
 perform 1 from public.customers where id=v_old.customer_id and org_id=v_org for update;
 select * into v_old from public.transactions where id=p_id and org_id=v_org for update;
 -- Reusing an operation ID after a lost response never applies the correction twice.
 if exists(select 1 from public.transaction_corrections where id=p_change_id and transaction_id=p_id and org_id=v_org and actor_id=auth.uid()) then
  return to_jsonb(v_old);
 end if;
 if v_old.deleted_at is not null then raise exception 'This transaction has been deleted'; end if;
 if p_expected_revision is distinct from v_old.revision then raise exception 'This transaction changed. Close and reopen it before editing.' using errcode='40001'; end if;
 if p_change_id is null or v_amount is null or v_amount<=0 or v_amount>999999999999
 or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount!=round(v_amount,case when v_old.type='CASH' then 2 else 3 end)
 or v_direction is null or v_direction not in ('IN','OUT') or v_date is null or not isfinite(v_date)
 or v_bill_amount<0 or v_bill_amount>999999999999 or v_bill_amount::text in ('NaN','Infinity','-Infinity') or v_bill_amount!=round(v_bill_amount,2)
 or v_reason is null or length(v_reason) not between 1 and 500 or length(v_bill)>64 or length(v_description)>2000 then
  raise exception 'Invalid correction: check amount, date, bill number and reason';
 end if;
 v_column := private.balance_column(v_old.category,v_old.type);
 select jsonb_object_agg(key,value) into v_before from jsonb_each(to_jsonb(v_old)) where key=any(v_fields);
 update public.transactions set jama=case when v_direction='IN' then v_amount else 0 end,
 nave=case when v_direction='OUT' then v_amount else 0 end,direction=v_direction,
 grams=case when type='CASH' then grams else v_amount end,bill_amount=v_bill_amount,
 bill_number=v_bill,date=v_date,description=v_description,revision=revision+1
 where id=p_id returning * into v_new;
 select jsonb_object_agg(key,value) into v_after from jsonb_each(to_jsonb(v_new)) where key=any(v_fields);
 if v_before=v_after then raise exception 'No changes to save'; end if;
 v_delta := (v_new.jama-v_new.nave)-(v_old.jama-v_old.nave);
 execute format('update public.customers set %I=%I+$1,updated_at=now() where id=$2',v_column,v_column) using v_delta,v_old.customer_id;
 perform private.rebuild_running_balances(v_old.customer_id,v_old.category,v_old.type);
 select coalesce(nullif(display_name,''),role) into v_actor from public.profiles where id=auth.uid();
 insert into public.transaction_corrections(id,org_id,transaction_id,actor_id,actor_label,reason,before_values,after_values,revision)
 values(p_change_id,v_org,p_id,auth.uid(),coalesce(v_actor,'Owner'),v_reason,v_before,v_after,v_new.revision);
 select * into v_new from public.transactions where id=p_id;
 return to_jsonb(v_new);
end $$;
revoke all on function public.edit_transaction(uuid,integer,uuid,jsonb) from public,anon;
grant execute on function public.edit_transaction(uuid,integer,uuid,jsonb) to authenticated;

create or replace function public.delete_transaction(p_transaction_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_tx public.transactions; v_column text;
begin
 if auth.uid() is null or private.user_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501'; end if;
 select * into v_tx from public.transactions where id=p_transaction_id and org_id=private.org_id();
 if not found then raise exception 'Transaction not found'; end if;
 perform 1 from public.customers where id=v_tx.customer_id for update;
 select * into v_tx from public.transactions where id=p_transaction_id for update;
 if v_tx.deleted_at is not null then return; end if;
 v_column := private.balance_column(v_tx.category,v_tx.type);
 execute format('update public.customers set %I=%I+$1,updated_at=now() where id=$2',v_column,v_column) using v_tx.nave-v_tx.jama,v_tx.customer_id;
 update public.transactions set deleted_at=now(),revision=revision+1 where id=v_tx.id;
 perform private.rebuild_running_balances(v_tx.customer_id,v_tx.category,v_tx.type);
end $$;
commit;
