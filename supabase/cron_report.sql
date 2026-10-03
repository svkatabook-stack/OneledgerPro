-- Run ONLY after the function is deployed and a manual report has been verified.
-- Add these secrets in Supabase Vault first:
-- oneledger_project_url = https://zlcittlgjvsiwstkhjvv.supabase.co
-- oneledger_cron_secret = same strong value as Edge Function CRON_SECRET
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='oneledger_cron_secret' and length(decrypted_secret)>=32)
 or not exists(select 1 from vault.decrypted_secrets where name='oneledger_project_url' and decrypted_secret='https://zlcittlgjvsiwstkhjvv.supabase.co') then
  raise exception 'Configure the OneLedger Vault secrets before scheduling';
 end if;
end $$;
-- 00:15 IST: report covers the entire previous day, including late-night entries.
select cron.schedule('oneledger-daily-report','45 18 * * *', $$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='oneledger_project_url') || '/functions/v1/send-report?type=daily',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='oneledger_cron_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 60000
 );
$$);
-- Sunday 08:00 IST: previous Sunday through Saturday, seven complete days.
select cron.schedule('oneledger-weekly-report','30 2 * * 0', $$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='oneledger_project_url') || '/functions/v1/send-report?type=weekly',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='oneledger_cron_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 60000
 );
$$);
select jobname,schedule,active from cron.job where jobname like 'oneledger-%';
