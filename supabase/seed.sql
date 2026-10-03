-- Run in SQL Editor AFTER creating and confirming the owner in Authentication > Users.
-- This administrator-only script never stores or sets the owner's password.
begin;
do $$
declare v_user uuid; v_org uuid := '00000000-0000-0000-0000-000000000001';
begin
 select id into v_user from auth.users where lower(email)='s.vkatabook@gmail.com' and email_confirmed_at is not null;
 if v_user is null then raise exception 'Create the confirmed owner s.vkatabook@gmail.com first'; end if;
 insert into public.organizations(id,name) values(v_org,'OneLedger Pro') on conflict(id) do nothing;
 insert into public.profiles(id,org_id,role,display_name) values(v_user,v_org,'owner','Owner')
 on conflict(id) do update set org_id=excluded.org_id,role=excluded.role,display_name=excluded.display_name;
 insert into public.chit_schemes(org_id,name,is_default)
 select v_org,unnest(array['CHIT','DIWALI FUND','GOLD SCHEME','SILVER SCHEME','MONTHLY SCHEME']),true
 on conflict(org_id,name) do nothing;
end $$;
commit;
