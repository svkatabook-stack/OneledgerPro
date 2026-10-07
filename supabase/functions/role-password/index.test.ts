import { handleRequest } from './index.ts';
const org = '00000000-0000-0000-0000-000000000001';
const owner = { id: '11111111-1111-4111-8111-111111111111', email: 's.vkatabook@gmail.com' };
const staff = { id: '22222222-2222-4222-8222-222222222222', email: 'oneledger-staff@accounts.invalid' };
function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
async function scenario(callerRole: string, validPassword: boolean, role: string, status: number) {
    for (const [k,v] of Object.entries({ SUPABASE_URL:'https://test.invalid', SUPABASE_SERVICE_ROLE_KEY:'service', SUPABASE_ANON_KEY:'anon' })) Deno.env.set(k,v);
    const original = globalThis.fetch;
    const writes: string[] = [];
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method || 'GET';
        const json = (data: unknown, code = 200) => Promise.resolve(new Response(JSON.stringify(data), { status:code, headers:{'Content-Type':'application/json'} }));
        if (url.pathname === '/auth/v1/user') return json(owner);
        if (url.pathname === '/auth/v1/token') return validPassword ? json({ access_token:'verified-token', refresh_token:'refresh', expires_in:3600, user:owner }) : json({message:'Invalid login credentials'},400);
        if (url.pathname === '/auth/v1/logout') return new Response(null,{status:204});
        if (url.pathname === '/rest/v1/profiles' && method === 'GET') return json({ org_id:org,role:url.searchParams.get('id')?.includes(staff.id)?'staff':callerRole });
        if (url.pathname === '/auth/v1/admin/users' && method === 'GET') return json({ users:[owner,staff], aud:'authenticated', next_page:null });
        writes.push(url.pathname);
        if (url.pathname === '/rest/v1/profiles') return json({});
        if (url.pathname === '/auth/v1/admin/users/'+staff.id) return json({user:staff});
        throw new Error('Unexpected request '+url.pathname);
    };
    try {
        const response = await handleRequest(new Request('https://test.invalid/role-password',{ method:'POST',headers:{Authorization:'Bearer caller-token'},body:JSON.stringify({role,password:'new-test-password',ownerPassword:'current-test-password'}) }));
        assert(response.status === status, `Expected ${status}, got ${response.status}`);
        assert(status === 200 ? writes.includes('/auth/v1/admin/users/'+staff.id) : writes.length === 0, 'Unauthorized credential mutation');
    } finally { globalThis.fetch = original; }
}
Deno.test('Staff cannot change any role password',()=>scenario('staff',true,'owner',403));
Deno.test('Owner must reauthenticate before mutation',()=>scenario('owner',false,'staff',403));
Deno.test('Invalid role cannot choose arbitrary account',()=>scenario('owner',true,'super-admin',400));
Deno.test('Verified Owner changes only configured Staff account',()=>scenario('owner',true,'staff',200));
Deno.test('Anonymous request is denied',async()=>{ const result=await handleRequest(new Request('https://test.invalid',{method:'POST'})); assert(result.status===401); });
