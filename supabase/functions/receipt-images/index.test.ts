import {handleRequest, signature} from './index.ts';
const org='00000000-0000-0000-0000-000000000001';
const user='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const asset=`oneledger/${org}/${other}/33333333-3333-4333-8333-333333333333`;
function assert(value:unknown,message='Assertion failed'):asserts value {if(!value) throw new Error(message);}
const env={SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon',CLOUDINARY_CLOUD_NAME:'test-cloud',CLOUDINARY_API_KEY:'test-key',CLOUDINARY_API_SECRET:'test-secret',CLOUDINARY_UPLOAD_PRESET:'oneledger_receipts'};
async function setup(role:string, attached:boolean, run:()=>Promise<void>, uploadFail=false) {
 for(const [k,v] of Object.entries(env)) Deno.env.set(k,v);
 const original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if(url.pathname==='/auth/v1/user') return json({id:user,email:'test@example.com'});
  if(url.pathname==='/rest/v1/profiles') return json({org_id:org,role});
  if(url.pathname==='/rest/v1/transactions') {
   assert(url.searchParams.get('org_id')===`eq.${org}`,'Org filter missing');
   if(role!=='owner') assert(url.searchParams.get('deleted_at')==='is.null','Deleted receipt not filtered');
   assert(url.searchParams.get('images')==='cs.'+JSON.stringify([{id:asset}]),'Asset lookup missing');
   return json(attached?[{id:'transaction'}]:[]);
  }
  if(url.hostname==='api.cloudinary.com'&&url.pathname.endsWith('/image/upload')) {
   assert(role!=='view','View reached upload');
   const form=init?.body as FormData;
   assert(form.get('type')==='authenticated','Public upload');
   assert(form.get('overwrite')==='false','Overwrite enabled');
   assert(String(form.get('public_id')).startsWith(`oneledger/${org}/${user}/`),'Incorrect namespace');
   assert(form.get('signature'),'Unsigned upload');
   return uploadFail?json({error:{message:'rejected'}},400):json({public_id:form.get('public_id'),type:'authenticated',resource_type:'image',format:'webp',bytes:100});
  }
  throw new Error('Unexpected request '+url);
 };
 try {await run();} finally {globalThis.fetch=original;}
}
function request(action:string,body:BodyInit,type='application/json') {return new Request(`https://test.invalid/functions/v1/receipt-images?action=${action}`,{method:'POST',headers:{authorization:'Bearer session','Content-Type':type},body});}
const webp=new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80]);
Deno.test('anonymous denied',async()=>{const r=await handleRequest(new Request('https://test.invalid',{method:'POST'}));assert(r.status===401);});
Deno.test('View cannot upload',()=>setup('view',true,async()=>{const r=await handleRequest(request('upload',webp,'image/webp'));assert(r.status===403);}));
Deno.test('cross-ledger reads denied',()=>setup('owner',true,async()=>{const r=await handleRequest(request('read',JSON.stringify({id:asset.replace(org,other)})));assert(r.status===403);}));
Deno.test('unattached receipt denied to another user',()=>setup('staff',false,async()=>{const r=await handleRequest(request('read',JSON.stringify({id:asset})));assert(r.status===403);}));
Deno.test('View receives expiring authenticated URL for saved receipt',()=>setup('view',true,async()=>{const r=await handleRequest(request('read',JSON.stringify({id:asset})));assert(r.status===200, 'Read status '+r.status+' '+await r.clone().text());const data=await r.json();const url=new URL(data.url);assert(url.searchParams.get('type')==='authenticated');assert(url.searchParams.get('attachment')==='false');assert(Number(url.searchParams.get('expires_at'))-Number(url.searchParams.get('timestamp'))===300);assert(!data.url.includes('test-secret'));}));
Deno.test('successful signed upload returns reference only',()=>setup('staff',false,async()=>{const r=await handleRequest(request('upload',webp,'image/webp'));assert(r.status===200);const data=await r.json();assert(data.image.provider==='cloudinary');assert(!data.image.url&&!data.signature);}));
Deno.test('upload failure is not reported as saved',()=>setup('owner',false,async()=>{const r=await handleRequest(request('upload',webp,'image/webp'));assert(r.status===502);},true));
Deno.test('invalid format denied',()=>setup('owner',false,async()=>{const r=await handleRequest(request('upload','not-an-image','image/webp'));assert(r.status===415);}));
Deno.test('oversized image denied',()=>setup('owner',false,async()=>{const r=await handleRequest(request('upload',new Uint8Array(300*1024+1),'image/webp'));assert(r.status===413);}));
Deno.test('missing secret fails closed',()=>setup('owner',false,async()=>{Deno.env.delete('CLOUDINARY_API_SECRET');const r=await handleRequest(request('upload',webp,'image/webp'));assert(r.status===503);}));
Deno.test('signing matches SHA256 independent test vector',async()=>{assert(await signature({b:'2',a:'1'},'secret')===''+await sha('a=1&b=2secret'));});
async function sha(s:string){const {createHash}=await import('node:crypto');return createHash('sha256').update(s).digest('hex');}
