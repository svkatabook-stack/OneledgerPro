-- Existing numbers are preserved. Blank bill numbers are allowed on multiple transactions.
begin;
drop trigger assign_bill_number on public.transactions;
alter table public.transactions alter column bill_number drop not null;
create or replace function public.record_transaction(p_id uuid,p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_org uuid := private.org_id(); v_customer public.customers; v_tx public.transactions;
 v_category text := p_entry->>'category'; v_type text := p_entry->>'type';
 v_column text := private.balance_column(v_category,v_type);
 v_jama numeric := coalesce((p_entry->>'jama')::numeric,0);
 v_nave numeric := coalesce((p_entry->>'nave')::numeric,0);
 v_before numeric; v_after numeric; v_sub text;
 v_bill text := nullif(upper(btrim(p_entry->>'bill_number')), '');
begin
 if auth.uid() is null or v_org is null or private.user_role() not in ('owner','staff') then
  raise exception 'Write access required' using errcode='42501';
 end if;
 if length(v_bill)>64 then raise exception 'Bill number must be 64 characters or fewer'; end if;
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
  or v_tx.bill_number is distinct from v_bill or v_tx.type!=v_type or v_tx.jama!=v_jama or v_tx.nave!=v_nave or v_tx.deleted_at is not null then
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
 grams,bill_amount,bill_number,chit_scheme,description,date,time,added_by,images,current_balance,new_balance,due_date)
 values(p_id,v_org,v_customer.id,v_category,v_sub,v_type,case when v_jama>0 then 'IN' else 'OUT' end,
 v_jama,v_nave,case when v_type='CASH' then 0 else v_jama+v_nave end,
 coalesce((p_entry->>'bill_amount')::numeric,0),v_bill,coalesce(p_entry->>'chit_scheme',''),
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


commit;
