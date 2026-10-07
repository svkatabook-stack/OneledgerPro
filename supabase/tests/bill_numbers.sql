-- Isolated database only. All fixture changes are rolled back.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','owner@test.invalid'),
 ('10000000-0000-0000-0000-000000000002','staff@test.invalid'),
 ('10000000-0000-0000-0000-000000000003','view@test.invalid');
insert into public.organizations(id,name) values('20000000-0000-0000-0000-000000000001','Test shop');
update public.profiles set org_id='20000000-0000-0000-0000-000000000001',role='owner';
update public.profiles set role='staff' where id='10000000-0000-0000-0000-000000000002';
update public.profiles set role='view' where id='10000000-0000-0000-0000-000000000003';
insert into public.customers(id,org_id,name,mobile) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Test customer','9000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ declare r jsonb; p jsonb := '{"customerId":"30000000-0000-0000-0000-000000000001","category":"RETAIL","type":"CASH","jama":100,"nave":0,"date":"2026-10-07","time":"12:00:00","bill_number":" manual-001 "}'; begin
 r:=public.record_transaction('40000000-0000-0000-0000-000000000001',p);
 if r->>'bill_number' != 'MANUAL-001' then raise exception 'Incorrect automatic bill %',r; end if;
 r:=public.record_transaction('40000000-0000-0000-0000-000000000001',p);
 if r->>'bill_number' != 'MANUAL-001' then raise exception 'Retry changed bill'; end if;
 perform public.delete_transaction('40000000-0000-0000-0000-000000000001');
 begin
  perform public.record_transaction('40000000-0000-0000-0000-000000000009',p); raise exception 'Duplicate bill allowed';
 exception when unique_violation then null; end;
 p:=p-'bill_number';
 r:=public.record_transaction('40000000-0000-0000-0000-000000000002',p);
 if r->>'bill_number' is not null then raise exception 'Deleted bill reused'; end if;
 r:=public.record_transaction('40000000-0000-0000-0000-000000000003',p);
 if r->>'bill_number' is not null then raise exception 'Counter mismatch'; end if;
 begin
  perform * from private.bill_counters; raise exception 'Counter exposed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.transactions set created_at=now()-interval '48 hours' where id='40000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ declare r jsonb; begin
 if (select count(*) from public.transactions)!=1 then raise exception 'Staff sees old/deleted history'; end if;
 r:=public.record_transaction('40000000-0000-0000-0000-000000000004','{"customerId":"30000000-0000-0000-0000-000000000001","category":"BULLION","type":"GOLD","jama":1,"nave":0,"date":"2026-10-07","time":"12:00:00"}');
 if r->>'bill_number' is not null then raise exception 'Staff/category sequence mismatch'; end if;
 begin
  perform public.delete_transaction('40000000-0000-0000-0000-000000000004'); raise exception 'Staff deleted transaction';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $$ begin
 if (select count(*) from public.transactions)!=2 then raise exception 'View sees old/deleted history'; end if;
 begin
  perform public.record_transaction(gen_random_uuid(),'{}'); raise exception 'View wrote transaction';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ begin
 if (select count(*) from public.transactions)!=4 then raise exception 'Owner lost full history'; end if;
end $$;
reset role;
rollback;
select 'PASS: manual bills, optional blanks, retries, duplicate rejection, staff write, role history boundaries' as result;
