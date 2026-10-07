import { test, expect } from '@playwright/test';
const userId='10000000-0000-0000-0000-000000000001';
const orgId='20000000-0000-0000-0000-000000000001';
const customerId='30000000-0000-0000-0000-000000000001';
async function mockCloud(page, linked = true, role='owner') {
 const state={role, reads:0, readFail:false, commitThenFail:false, txs:[], balance:0, fail:false, ids:[], tokenRequests:0, loginEmails:[]};
 const user={id:userId,email:'s.vkatabook@gmail.com',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-10-03T00:00:00Z'};
 const jwt=[{alg:'HS256',typ:'JWT'},{sub:userId,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'},'signature'].map(v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url')).join('.');
 await page.route('http://127.0.0.1:54399/**',async route=>{
  const req=route.request(); const url=new URL(req.url());
  const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if (url.pathname==='/auth/v1/token') { state.tokenRequests++; state.loginEmails.push(req.postDataJSON().email); return respond({access_token:jwt,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user}); }
  if (url.pathname==='/auth/v1/user') return respond(user);
  if (url.pathname==='/auth/v1/logout') return respond({});
  if (url.pathname==='/rest/v1/profiles') {
   const profile={id:userId,org_id:linked?orgId:null,role:state.role,display_name:'Owner'};
   return respond(url.searchParams.has('id')?profile:[profile]);
  }
  if (url.pathname==='/rest/v1/customers') return respond([{id:customerId,org_id:orgId,name:'Cloud Customer',mobile:'9000000001',retail_cash:state.balance,created_at:'2026-10-03T00:00:00Z'}]);
  if (url.pathname==='/rest/v1/transactions') { state.reads++; return state.readFail ? respond({message:'Refresh unavailable'},503) : respond(state.txs); }
  if (url.pathname==='/rest/v1/chit_schemes') return respond([{id:'scheme',org_id:orgId,name:'CHIT'}]);
  if (url.pathname==='/rest/v1/rpc/record_transaction') {
   const payload=req.postDataJSON(); state.ids.push(payload.p_id);
   if(state.fail) return respond({message:'Database unavailable',code:'XX000'},500);
   const existing=state.txs.find(t=>t.id===payload.p_id); if(existing) return respond(existing);
   const p=payload.p_entry; state.balance+=p.jama-p.nave;
   const row={id:payload.p_id,bill_number:'OLP-'+String(state.txs.length+1).padStart(6,'0'),org_id:orgId,customer_id:p.customerId,category:p.category,sub_type:p.sub_type,type:p.type,direction:'IN',jama:p.jama,nave:p.nave,date:p.date,time:p.time,current_balance:0,new_balance:state.balance,created_at:new Date().toISOString(),images:p.images||[]};
   state.txs.push(row); if(state.commitThenFail){state.commitThenFail=false;return route.abort('failed');} return respond(row);
  }
  return respond({message:'Unexpected mock endpoint'},404);
 });
 return state;
}
async function login(page, role='Owner') {
 await page.goto('/');
 await page.getByRole('button',{name:new RegExp(role)}).click();
 await page.getByPlaceholder('Password',{exact:true}).fill('test-only-password');
 await page.getByRole('button',{name:'Sign In',exact:true}).click();
}
test('cloud ignores forged demo session; failed writes stay unsaved and retry uses same ID',async({page})=>{
 const state=await mockCloud(page);
 await page.addInitScript(()=>{
  localStorage.setItem('oneledger_auth',JSON.stringify({role:'super-admin'}));
  localStorage.setItem('oneledger_customers',JSON.stringify([{id:'fake',name:'Private Demo Customer'}]));
 });
 await login(page);
 await expect(page.locator('.app-header')).toContainText('OneLedger Pro');
 await page.goto('/transactions');
 await page.locator('.atp-cat-name').filter({hasText:/^Retail$/}).click();
 await expect(page.getByText('Private Demo Customer')).toHaveCount(0);
 await page.locator('.atp-cust-row').click();
 await page.locator('.atp-amount-input').fill('100');
 state.fail=true;
 await page.getByRole('button',{name:'Save Transaction',exact:true}).click();
 await expect(page.getByText(/Transaction not confirmed/)).toBeVisible();
 await expect(page.locator('.popup-overlay')).toHaveCount(0);
 expect(state.balance).toBe(0);
 state.fail=false;
 await page.getByRole('button',{name:'Save Transaction',exact:true}).click();
 await expect(page.locator('.popup-overlay')).toBeVisible();
 expect(state.ids).toHaveLength(2);
 expect(state.ids[0]).toBe(state.ids[1]);
 expect(state.balance).toBe(100);
 await page.goto('/settings');
 await expect(page.getByText('Cloud access',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Load Dummy Data'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Clear All Data'})).toHaveCount(0);
 expect(state.tokenRequests).toBe(1);
});
test('unlinked authenticated user cannot enter ledger',async({page})=>{
 await mockCloud(page,false); await login(page);
 await expect(page.getByRole('alert')).toContainText('no ledger access');
 await expect(page.locator('.app-header')).toHaveCount(0);
});
test('view role cannot enter transaction form',async({page})=>{
 const state=await mockCloud(page,true,'view'); await login(page,'View');
 expect(state.loginEmails).toEqual(['oneledger-view@accounts.invalid']);
 await expect(page.locator('.app-header')).toBeVisible();
 await page.goto('/transactions');
 await expect(page.getByText('Your account has read-only access.')).toBeVisible();
});

test('owner settings submit password changes only after matching confirmation',async({page})=>{
 await mockCloud(page); let submitted;
 await page.route('**/functions/v1/role-password',async route=>{submitted=route.request().postDataJSON(); await route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});});
 await login(page); await expect(page.locator('.app-header')).toBeVisible();
 await page.goto('/settings');
 await page.getByRole('button',{name:'Change',exact:true}).nth(1).click();
 await page.getByLabel('Current Owner password').fill('current-owner-test');
 await page.getByPlaceholder('New passcode (min 6 chars)').fill('new-staff-test');
 await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
 await page.getByLabel('Confirm new password').fill('new-staff-test');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByText('Staff passcode updated.')).toBeVisible();
 expect(submitted).toEqual({role:'staff',password:'new-staff-test',ownerPassword:'current-owner-test'});
});

test('cloud receipt upload persists only the reference and resolves again after reload',async({page})=>{
 const state=await mockCloud(page);
 const id='oneledger/'+orgId+'/'+userId+'/40000000-0000-4000-8000-000000000001';
 const photo={id,provider:'cloudinary',format:'webp',name:'receipt.webp',size:100};
 let reads=0,uploads=0;
 await page.route('**/functions/v1/receipt-images?*',async route=>{
  if(new URL(route.request().url()).searchParams.get('action')==='upload') {uploads++; return route.fulfill({contentType:'application/json',body:JSON.stringify({image:photo})});}
  reads++; return route.fulfill({contentType:'application/json',body:JSON.stringify({url:'https://api.cloudinary.com/test/receipt.png',expiresAt:Date.now()+300000})});
 });
 await page.route('https://api.cloudinary.com/test/receipt.png',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')}));
 await login(page); await expect(page.locator('.app-header')).toBeVisible();
 await page.goto('/transactions'); await page.locator('.atp-cat-name').filter({hasText:/^Retail$/}).click();
 await page.locator('.atp-cust-row').click(); await page.locator('.atp-amount-input').fill('10');
 await page.locator('input[type=file]').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 await expect(page.getByAltText('Customer property',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Save Transaction',exact:true}).click();
 await expect(page.locator('.popup-overlay')).toBeVisible();
 expect(uploads).toBe(1); expect(state.txs[0].images).toEqual([photo]);
 await page.goto('/customers/'+customerId);
 await page.locator('tbody tr').first().click();
 await expect(page.getByAltText('Receipt 1',{exact:true})).toBeVisible();
 expect(reads).toBeGreaterThanOrEqual(2);
});

async function openEntry(page) {
 await page.goto('/transactions');
 await page.locator('.atp-cat-name').filter({hasText:/^Retail$/}).click();
 await page.locator('.atp-cust-row').click();
 await page.locator('.atp-amount-input').fill('100');
}
const fixtureTx = (number, age=0, type='CASH') => ({id:crypto.randomUUID(),bill_number:number,org_id:orgId,customer_id:customerId,category:'RETAIL',sub_type:type==='CASH'?'CASH':'METAL',type,jama:10,nave:0,date:'2026-10-07',time:'12:00:00',current_balance:0,new_balance:10,created_at:new Date(Date.now()-age).toISOString(),images:[]});

test('bill number survives a lost response retry and filters ledger/export', async({page})=>{
 const state=await mockCloud(page); await login(page); await expect(page.locator('.app-header')).toBeVisible();
 await openEntry(page); state.commitThenFail=true;
 await page.getByRole('button',{name:'Save Transaction',exact:true}).click();
 await expect(page.getByText(/Transaction not confirmed/)).toBeVisible();
 await page.getByRole('button',{name:'Save Transaction',exact:true}).click();
 await expect(page.locator('.popup-overlay')).toContainText('OLP-000001');
 expect(state.txs).toHaveLength(1); expect(state.balance).toBe(100); expect(state.ids[0]).toBe(state.ids[1]);
 state.txs.push(fixtureTx('OLP-000002',0,'GOLD'));
 await page.goto('/ledger'); await page.getByRole('button',{name:'Global',exact:true}).click();
 await page.getByLabel('Bill Number',{exact:true}).fill('olp-000002');
 await expect(page.locator('tbody')).toContainText('OLP-000002');
 await expect(page.locator('tbody')).not.toContainText('OLP-000001');
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export filtered',exact:true}).click();
 const download=await downloadPromise;
 const XLSX=await import('xlsx'); const fs=await import('node:fs');
 const workbook=XLSX.read(fs.readFileSync(await download.path()));
 const rows=XLSX.utils.sheet_to_json(workbook.Sheets['Gold-Silver Grams']);
 expect(rows).toHaveLength(1); expect(rows[0]['Bill Number']).toBe('OLP-000002');
 expect(XLSX.utils.sheet_to_json(workbook.Sheets['Rupee Transactions'])).toHaveLength(0);
 await page.getByRole('button',{name:'Bullion',exact:true}).click();
 await expect(page.getByText('No transactions found.',{exact:true})).toBeVisible();
});

test('offline form stays intact, recovery refreshes missed changes, and failed refresh preserves data',async({page,context})=>{
 const state=await mockCloud(page); await login(page); await expect(page.locator('.app-header')).toBeVisible();
 await openEntry(page);
 const beforeFocus=state.reads;
 await page.evaluate(() => {window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(()=>state.reads).toBeGreaterThan(beforeFocus);
 await expect(page.locator('.atp-amount-input')).toHaveValue('100');
 await context.setOffline(true);
 await expect(page.getByText(/Offline — reconnect/)).toBeVisible();
 await page.getByRole('button',{name:'Save Transaction',exact:true}).click();
 await expect(page.getByText(/Transaction not confirmed/)).toBeVisible();
 expect(state.ids).toHaveLength(0);
 const before=state.reads; state.txs.push(fixtureTx('OLP-000001'));
 await context.setOffline(false); await expect.poll(()=>state.reads).toBeGreaterThan(before);
 await expect(page.locator('.atp-amount-input')).toHaveValue('100');
 await page.goto('/ledger'); await page.getByRole('button',{name:'Global',exact:true}).click();
 await expect(page.locator('tbody')).toContainText('OLP-000001');
 state.readFail=true; await page.getByRole('button',{name:'Refresh data'}).click();
 await expect(page.getByRole('alert')).toContainText('Refresh unavailable');
 await expect(page.locator('tbody')).toContainText('OLP-000001');
 state.readFail=false; await page.getByRole('button',{name:'Refresh data'}).click();
 await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const role of ['staff','view']) test(`${role} cannot see old history, deleted items or owner controls`,async({page})=>{
 const state=await mockCloud(page,true,role);
 state.txs.push(fixtureTx('OLP-000001',48*3600000),fixtureTx('OLP-000002'));
 await login(page,role==='staff'?'Staff':'View'); await expect(page.locator('.app-header')).toBeVisible();
 await page.goto('/customers/'+customerId);
 await expect(page.locator('tbody')).not.toContainText('OLP-000001');
 await expect(page.locator('tbody')).toContainText('OLP-000002');
 await page.goto('/ledger'); await expect(page.getByRole('button',{name:'Recently Deleted'})).toHaveCount(0);
 await page.goto('/settings'); await expect(page.getByRole('button',{name:'Change',exact:true})).toHaveCount(0);
 if(role==='view') { await page.goto('/customers'); await page.getByPlaceholder('Search by name or mobile...').fill('Cloud'); await expect(page.getByTitle('Edit customer')).toBeDisabled(); }
 state.role='view'; if(role==='view') state.role='staff';
 await page.getByRole('button',{name:'Refresh data'}).click();
 await expect(page.getByRole('alert')).toContainText('access changed');
 await expect(page.locator('.app-header')).toHaveCount(0);
});
