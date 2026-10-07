-- Preserve the established 24-hour Staff/View history rule at the database boundary.
begin;
drop policy transaction_read on public.transactions;
create policy transaction_read on public.transactions for select to authenticated
using(org_id=private.org_id() and (
 private.user_role()='owner' or
 (private.user_role() in ('staff','view') and deleted_at is null and created_at >= now()-interval '24 hours')
));
commit;
