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
