import { createClient } from 'npm:@supabase/supabase-js@2.100.0';

const emails = { owner: 's.vkatabook@gmail.com', staff: 'oneledger-staff@accounts.invalid', view: 'oneledger-view@accounts.invalid' };
const orgId = '00000000-0000-0000-0000-000000000001';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
const options = { auth: { persistSession: false, autoRefreshToken: false } };

export async function handleRequest(req: Request) {
    if (req.method === 'OPTIONS') return new Response(null, { headers });
    if (req.method !== 'POST') return reply(405, { error: 'POST required.' });
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !key || !anon) return reply(503, { error: 'Password management is not configured.' });
    try {
        const token = req.headers.get('authorization')?.replace(/^Bearer /i, '');
        if (!token) return reply(401, { error: 'Sign in as Owner.' });
        const admin = createClient(url, key, options);
        const { data: caller, error: authError } = await admin.auth.getUser(token);
        if (authError || !caller.user) return reply(401, { error: 'Sign in as Owner.' });
        const { data: profile, error: profileError } = await admin.from('profiles').select('role,org_id').eq('id', caller.user.id).single();
        if (profileError || profile?.role !== 'owner' || profile.org_id !== orgId || caller.user.email !== emails.owner) return reply(403, { error: 'Owner access required.' });
        const raw = await req.text();
        if (raw.length > 4096) return reply(400, { error: 'Request too large.' });
        const { role, password, ownerPassword } = JSON.parse(raw);
        if (!Object.hasOwn(emails, role) || typeof password !== 'string' || password.length < 6 || password.length > 72 || typeof ownerPassword !== 'string' || ownerPassword.length > 256) return reply(400, { error: 'Choose a role and a password of 6–72 characters.' });
        // Re-authenticate using Supabase's password verification and rate limits.
        const verifier = createClient(url, anon, options);
        const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({ email: emails.owner, password: ownerPassword });
        if (verifyError || verified.user?.id !== caller.user.id) return reply(403, { error: 'Current Owner password is incorrect.' });
        await verifier.auth.signOut({ scope: 'local' });
        const email = emails[role as keyof typeof emails];
        // Look up only the configured role identity. Never accept a user ID from a client.
        let target: { id: string } | undefined;
        for (let page = 1; ; page++) {
            const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
            if (error) throw error;
            target = data.users.find(u => u.email === email);
            if (target || data.users.length < 100) break;
        }
        if (target) {
            const { data: existing, error } = await admin.from('profiles').select('org_id,role').eq('id', target.id).single();
            if (error || (existing.org_id && (existing.org_id !== orgId || existing.role !== role))) return reply(409, { error: 'Role account needs administrator review.' });
        } else {
            if (role === 'owner') return reply(409, { error: 'Owner account missing.' });
            const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
            if (error || !data.user) throw error || new Error('Could not create role account');
            target = data.user;
        }
        // Profile linking is retryable if an earlier create succeeded but linking failed.
        const { error: linkError } = await admin.from('profiles').upsert({ id: target.id, org_id: orgId, role, display_name: role[0].toUpperCase() + role.slice(1) });
        if (linkError) throw linkError;
        const { error } = await admin.auth.admin.updateUserById(target.id, { password });
        if (error) return reply(400, { error: 'Password update rejected. Use a different password and retry.' });
        return reply(200, { ok: true });
    } catch {
        return reply(500, { error: 'Password was not confirmed changed. Retry or contact your administrator.' });
    }
}

if (import.meta.main) Deno.serve(handleRequest);
