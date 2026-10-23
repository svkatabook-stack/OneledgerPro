-- Isolated local test database only. Fixtures are rolled back.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','owner@test.invalid'),
 ('10000000-0000-0000-0000-000000000002','staff@test.invalid'),
 ('10000000-0000-0000-0000-000000000003','view@test.invalid'),
 ('10000000-0000-0000-0000-000000000004','other@test.invalid');
insert into public.organizations(id,name) values('20000000-0000-0000-0000-000000000001','Test'),('20000000-0000-0000-0000-000000000002','Other');
update public.profiles set org_id='20000000-0000-0000-0000-000000000001',role='owner',display_name='Test Owner';
update public.profiles set role='staff' where id='10000000-0000-0000-0000-000000000002';
update public.profiles set role='view' where id='10000000-0000-0000-0000-000000000003';
update public.profiles set org_id='20000000-0000-0000-0000-000000000002' where id='10000000-0000-0000-0000-000000000004';
insert into public.customers(id,org_id,name,mobile) values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Test','9000000000');
insert into public.chit_schemes(org_id,name) values('20000000-0000-0000-0000-000000000001','CHIT');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ declare
 pair text[]; tx_id uuid; later_id uuid; operation uuid; result jsonb; b jsonb; changes jsonb;
 begin
 foreach pair slice 1 in array array[['RETAIL','CASH'],['RETAIL','GOLD'],['BULLION','CASH'],['BULLION','GOLD'],['BULLION','SILVER'],['SILVER','CASH'],['SILVER','SILVER'],['CHIT','CASH']] loop
  -- Stable IDs establish posting order for equal timestamps within this test transaction.
  tx_id:=('40000000-0000-0000-0000-'||lpad((100+(array_position(array['RETAIL-CASH','RETAIL-GOLD','BULLION-CASH','BULLION-GOLD','BULLION-SILVER','SILVER-CASH','SILVER-SILVER','CHIT-CASH'],pair[1]||'-'||pair[2])*2))::text,12,'0'))::uuid;
  later_id:=('40000000-0000-0000-0000-'||lpad((101+(array_position(array['RETAIL-CASH','RETAIL-GOLD','BULLION-CASH','BULLION-GOLD','BULLION-SILVER','SILVER-CASH','SILVER-SILVER','CHIT-CASH'],pair[1]||'-'||pair[2])*2))::text,12,'0'))::uuid;
  b:=jsonb_build_object('customerId','30000000-0000-0000-0000-000000000001','category',pair[1],'type',pair[2],'jama',100,'nave',0,'date','2026-10-23','time','10:00','chit_scheme','CHIT');
  perform public.record_transaction(tx_id,b);
  perform public.record_transaction(later_id,b||'{"jama":0,"nave":30}'::jsonb);
  changes:='{"amount":80,"direction":"IN","date":"2026-10-22","reason":"Paper bill correction","bill_amount":0}';
  operation:=gen_random_uuid();
  result:=public.edit_transaction(tx_id,0,operation,changes);
  if (result->>'new_balance')::numeric!=80 or (result->>'revision')::int!=1 then raise exception 'Bad corrected balance %',pair; end if;
  if (select new_balance from public.transactions where id=later_id)!=50 then raise exception 'Later balance wrong'; end if;
  perform public.edit_transaction(tx_id,0,operation,changes);
  if (select count(*) from public.transaction_corrections where transaction_id=tx_id)!=1 then raise exception 'Retry duplicated audit'; end if;
  begin
   perform public.edit_transaction(tx_id,0,gen_random_uuid(),changes||'{"amount":70}'); raise exception 'Stale edit accepted';
  exception when serialization_failure then null; end;
  result:=public.edit_transaction(tx_id,1,gen_random_uuid(),changes||'{"direction":"OUT","amount":1.25}');
  if (select new_balance from public.transactions where id=later_id)!= -31.25 then raise exception 'Direction reversal wrong'; end if;
  if (select before_values->>'jama' from public.transaction_corrections where transaction_id=tx_id and revision=1)::numeric!=100 then raise exception 'Audit lost original'; end if;
  perform public.delete_transaction(tx_id);
  if (select new_balance from public.transactions where id=later_id)!= -30 then raise exception 'Delete after edit wrong'; end if;
  begin
   perform public.edit_transaction(tx_id,3,gen_random_uuid(),changes); raise exception 'Deleted edit accepted';
  exception when raise_exception then if sqlerrm='Deleted edit accepted' then raise; end if; end;
 end loop;
 begin
  update public.transaction_corrections set reason='tamper'; raise exception 'Audit mutable';
 exception when insufficient_privilege then null; end;
 begin
  update public.transactions set jama=123; raise exception 'Direct edit allowed';
 exception when insufficient_privilege then null; end;
end $$;
-- Validation failures must roll back transaction, balance and history together.
do $$ declare patch jsonb; n_before integer; begin
 perform public.edit_transaction('40000000-0000-0000-0000-000000000117',0,gen_random_uuid(),
  '{"amount":30,"direction":"OUT","bill_number":"UNIQUE","date":"2026-10-23","reason":"Set bill"}');
 select count(*) into n_before from public.transaction_corrections;
 foreach patch in array array['{"amount":0}'::jsonb,'{"amount":-1}'::jsonb,'{"amount":"NaN"}'::jsonb,'{"amount":1.001}'::jsonb,'{"date":"2026-02-30"}'::jsonb,'{"reason":" "}'::jsonb,'{"bill_number":"UNIQUE"}'::jsonb] loop
  begin
   perform public.edit_transaction('40000000-0000-0000-0000-000000000103',0,gen_random_uuid(),
     '{"amount":20,"direction":"OUT","date":"2026-10-23","reason":"Test"}'::jsonb||patch);
   raise exception 'Invalid correction accepted';
  exception when others then if sqlerrm='Invalid correction accepted' then raise; end if; end;
  if (select revision from public.transactions where id='40000000-0000-0000-0000-000000000103')!=0 then raise exception 'Invalid edit changed revision'; end if;
  if (select count(*) from public.transaction_corrections)!=n_before then raise exception 'Invalid edit left audit'; end if;
  if (select retail_cash from public.customers where id='30000000-0000-0000-0000-000000000001')!= -30 then raise exception 'Invalid edit changed balance'; end if;
 end loop;
end $$;
-- Other roles and organizations may neither edit nor see history.
do $$ declare uid text; begin
 foreach uid in array array['10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004'] loop
  perform set_config('request.jwt.claim.sub',uid,true);
  if (select count(*) from public.transaction_corrections)!=0 then raise exception 'History leaked'; end if;
  begin
   perform public.edit_transaction('40000000-0000-0000-0000-000000000103',0,gen_random_uuid(),'{"amount":1}'); raise exception 'Unauthorized edit';
  exception when insufficient_privilege then null; end;
 end loop;
end $$;
reset role;
rollback;
select 'PASS: eight accounts, running balances, retries, conflict, reversal, audit, deletion and role/org isolation' as result;
