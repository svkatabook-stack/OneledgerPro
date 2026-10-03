-- Run only in an isolated test database after schema.sql. Changes are rolled back.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','owner@test.invalid'),
 ('10000000-0000-0000-0000-000000000002','view@test.invalid'),
 ('10000000-0000-0000-0000-000000000003','other@test.invalid');
insert into public.organizations(id,name) values
 ('20000000-0000-0000-0000-000000000001','Test shop'),
 ('20000000-0000-0000-0000-000000000002','Other shop');
update public.profiles set org_id='20000000-0000-0000-0000-000000000001',role='owner' where id='10000000-0000-0000-0000-000000000001';
update public.profiles set org_id='20000000-0000-0000-0000-000000000001',role='view' where id='10000000-0000-0000-0000-000000000002';
update public.profiles set org_id='20000000-0000-0000-0000-000000000002',role='owner' where id='10000000-0000-0000-0000-000000000003';
insert into public.customers(id,org_id,name,mobile) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Test customer','9000000001'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Other customer','9000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ declare r jsonb; p jsonb := '{"customerId":"30000000-0000-0000-0000-000000000001","category":"RETAIL","type":"CASH","jama":100,"nave":0,"date":"2026-10-03","time":"12:00:00"}'; begin
 if (select count(*) from public.customers)!=1 then raise exception 'RLS leaked another organization'; end if;
 r:=public.record_transaction('40000000-0000-0000-0000-000000000001',p);
 if (r->>'new_balance')::numeric !=100 then raise exception 'Incorrect balance'; end if;
 perform public.record_transaction('40000000-0000-0000-0000-000000000001',p);
 if (select retail_cash from public.customers limit 1)!=100 then raise exception 'Retry duplicated balance'; end if;
 begin
  perform public.record_transaction('40000000-0000-0000-0000-000000000002',p||'{"customerId":"30000000-0000-0000-0000-000000000002"}'::jsonb);
  raise exception 'Cross-org write allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.profiles set role='owner'; raise exception 'Profile role mutable';
 exception when insufficient_privilege then null; end;
 begin
  update public.customers set retail_cash=999; raise exception 'Direct balance write allowed';
 exception when insufficient_privilege then null; end;
 perform public.delete_transaction('40000000-0000-0000-0000-000000000001');
 perform public.delete_transaction('40000000-0000-0000-0000-000000000001');
 if (select retail_cash from public.customers limit 1)!=0 then raise exception 'Delete did not reverse exactly once'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 begin
  insert into public.customers(org_id,name,mobile) values('20000000-0000-0000-0000-000000000001','Forbidden','9000000099');
  raise exception 'View created customer';
 exception when insufficient_privilege then null; end;
 begin
  perform public.record_transaction(gen_random_uuid(),'{}'); raise exception 'View created transaction';
 exception when insufficient_privilege then null; end;
 begin
  perform public.delete_transaction('40000000-0000-0000-0000-000000000001'); raise exception 'View deleted transaction';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform * from public.customers; raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.record_transaction(gen_random_uuid(),'{}'); raise exception 'Anonymous RPC allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: organization isolation, view restrictions, private roles/balances, idempotent add/delete, anonymous denial' as result;
