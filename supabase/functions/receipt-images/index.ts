import { createClient } from 'npm:@supabase/supabase-js@2.100.0';

const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Content-Type':'application/json', 'Cache-Control':'no-store' };
const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: cors });
const MAX_BYTES = 300 * 1024;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const idPattern = new RegExp(`^oneledger/(${uuid})/(${uuid})/(${uuid})$`);

// Only server-generated/validated parameters reach this signer. Never sign caller-supplied parameters.
export async function signature(params: Record<string, string>, secret: string) {
    const text = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + secret;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2,'0')).join('');
}
async function readLimited(req: Request, max: number) {
    const reader = req.body?.getReader();
    if (!reader) throw new Error('Empty request');
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
        const {value,done} = await reader.read(); if (done) break;
        length += value.length;
        if (length > max) { await reader.cancel(); throw new Error('Request too large'); }
        chunks.push(value);
    }
    const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { result.set(chunk,offset); offset += chunk.length; }
    return result;
}
export async function handleRequest(req: Request) {
    if (req.method === 'OPTIONS') return new Response(null,{headers:cors});
    if (req.method !== 'POST') return reply(405,{error:'POST required.'});
    const token = req.headers.get('authorization')?.replace(/^Bearer /i,'');
    if (!token) return reply(401,{error:'Sign in to access receipt photos.'});
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !anon) return reply(503,{error:'Receipt service is not configured.'});
    // Use the caller's token for database reads: RLS still applies; no service-role key is needed.
    const client = createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
    try {
        const {data: auth,error: authError} = await client.auth.getUser(token);
        if (authError || !auth.user) return reply(401,{error:'Sign in to access receipt photos.'});
        const {data:profile,error:profileError} = await client.from('profiles').select('org_id,role').eq('id',auth.user.id).single();
        if (profileError || !profile?.org_id || !['owner','staff','view'].includes(profile.role)) return reply(403,{error:'Ledger access required.'});
        const action = new URL(req.url).searchParams.get('action');
        if (!['upload','read'].includes(action || '')) return reply(400,{error:'Invalid receipt action.'});
        if (action === 'upload' && !['owner','staff'].includes(profile.role)) return reply(403,{error:'Only Owner and Staff can upload receipts.'});
        const cloud = Deno.env.get('CLOUDINARY_CLOUD_NAME');
        const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
        const secret = Deno.env.get('CLOUDINARY_API_SECRET');
        const preset = Deno.env.get('CLOUDINARY_UPLOAD_PRESET');
        if (!cloud || !/^[a-z0-9_-]+$/i.test(cloud) || !apiKey || !secret || !preset || !/^[a-z0-9_-]+$/i.test(preset)) return reply(503,{error:'Cloudinary setup is incomplete. Ask the Owner to configure receipt storage.'});
        const timestamp = String(Math.floor(Date.now()/1000));
        if (action === 'upload') {
            let file: Uint8Array;
            try { file = await readLimited(req,MAX_BYTES); } catch { return reply(413,{error:'Receipt must be no larger than 300 KB after compression.'}); }
            const magic = new TextDecoder('ascii');
            if (file.length < 12 || magic.decode(file.slice(0,4)) !== 'RIFF' || magic.decode(file.slice(8,12)) !== 'WEBP' || req.headers.get('content-type')?.split(';')[0] !== 'image/webp') return reply(415,{error:'A compressed WebP receipt is required.'});
            const id = `oneledger/${profile.org_id}/${auth.user.id}/${crypto.randomUUID()}`;
            const params = { timestamp, public_id:id, upload_preset:preset, type:'authenticated', overwrite:'false', unique_filename:'false', use_filename:'false', allowed_formats:'webp' };
            const form = new FormData();
            for (const [k,v] of Object.entries(params)) form.append(k,v);
            form.append('api_key',apiKey); form.append('signature',await signature(params,secret));
            form.append('file',new Blob([new Uint8Array(file).buffer],{type:'image/webp'}),'receipt.webp');
            const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`,{method:'POST',body:form,signal:AbortSignal.timeout(30000)});
            const data = await response.json();
            if (!response.ok) return reply(502,{error:'Cloudinary rejected the upload. Check the signed receipt preset and credentials.'});
            if (data.public_id !== id || data.type !== 'authenticated' || data.resource_type !== 'image' || data.format !== 'webp') return reply(502,{error:'Receipt storage returned unexpected settings. Upload was not attached.'});
            return reply(200,{image:{id,provider:'cloudinary',format:'webp',name:'receipt.webp',size:data.bytes}});
        }
        let body;
        try { body = JSON.parse(new TextDecoder().decode(await readLimited(req,2048))); } catch { return reply(400,{error:'Invalid receipt request.'}); }
        const match = typeof body.id === 'string' ? idPattern.exec(body.id) : null;
        if (!match || match[1] !== profile.org_id) return reply(403,{error:'Receipt is not available to this ledger.'});
        // Uploaded previews are limited to their uploader. Other users need a visible saved transaction.
        if (match[2] !== auth.user.id || profile.role === 'view') {
            let query = client.from('transactions').select('id').eq('org_id',profile.org_id).filter('images','cs',JSON.stringify([{id:body.id}])).limit(1);
            if (profile.role !== 'owner') query = query.is('deleted_at',null);
            const {data,error} = await query;
            if (error || !data?.length) return reply(403,{error:'Receipt is not attached to an accessible transaction.'});
        }
        const expires = Number(timestamp) + 300;
        const params = {timestamp,public_id:body.id,format:'webp',type:'authenticated',attachment:'false',expires_at:String(expires)};
        const signed = new URLSearchParams({...params,api_key:apiKey,signature:await signature(params,secret)});
        return reply(200,{url:`https://api.cloudinary.com/v1_1/${cloud}/image/download?${signed}`,expiresAt:expires*1000});
    } catch {
        return reply(502,{error:'Receipt service is temporarily unavailable. Please retry.'});
    }
}
if (import.meta.main) Deno.serve(handleRequest);
