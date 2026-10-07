"""Run only against the isolated local PostgreSQL test server on port 55439."""
import concurrent.futures
import json
import subprocess

BASE = ['psql', '-h', '/private/tmp', '-p', '55439', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']
def sql(query):
    return subprocess.check_output(BASE + ['-c', query], text=True).strip()
assert 'oneledger-pg-cloud-test' in sql('show data_directory'), 'Refusing non-test database'
org='90000000-0000-0000-0000-000000000001'
user='90000000-0000-0000-0000-000000000002'
customers=['90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000004']
sql(f"insert into auth.users(id,email) values('{user}','concurrent@test.invalid'); insert into public.organizations(id,name) values('{org}','Concurrency test'); update public.profiles set org_id='{org}',role='owner' where id='{user}';" + ''.join(f"insert into public.customers(id,org_id,name,mobile) values('{cid}','{org}','Test {i}','990000000{i}');" for i,cid in enumerate(customers)))
def save(i):
    entry=json.dumps(dict(customerId=customers[i%2],category='RETAIL',type='CASH',jama=1,nave=0,date='2026-10-07',time='12:00:00'))
    tx=f'91000000-0000-0000-0000-{i+1:012d}'
    return sql(f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true); select public.record_transaction('{tx}','{entry}'::jsonb)->>'bill_number'; commit;")
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(save,range(20)))
    assert sql(f"select count(*)=20 and count(distinct bill_number)=20 from public.transactions where org_id='{org}'")=='t'
    assert sql(f"select sum(retail_cash)=20 from public.customers where org_id='{org}'")=='t'
    assert sql(f"select min(bill_number)='OLP-000001' and max(bill_number)='OLP-000020' from public.transactions where org_id='{org}'")=='t'
    save(0)
    assert sql(f"select count(*)=20 from public.transactions where org_id='{org}'")=='t'
    print('PASS: 20 simultaneous saves across 2 customers, unique bills, balances, idempotent retry')
finally:
    sql(f"delete from public.transactions where org_id='{org}'; delete from public.customers where org_id='{org}'; delete from private.bill_counters where org_id='{org}'; delete from auth.users where id='{user}'; delete from public.organizations where id='{org}';")
