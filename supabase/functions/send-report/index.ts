import { reportPeriod } from './report-period.js';
import { createClient } from 'npm:@supabase/supabase-js@2.100.0';
import * as XLSX from 'npm:xlsx@0.18.5';
import nodemailer from 'npm:nodemailer@6.10.1';

const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const GMAIL_USER  = Deno.env.get('GMAIL_USER')!;
const GMAIL_PASS  = Deno.env.get('GMAIL_PASS')!;
const REPORT_TO   = Deno.env.get('REPORT_TO')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const REPORT_ORG_ID = Deno.env.get('REPORT_ORG_ID') || '';
const escapeHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

async function readAll(table: string, orgId: string, from?: string, to?: string) {
    const rows = [];
    for (let start=0; ; start+=500) {
        let query = supabase.from(table).select('*').eq('org_id',orgId).order('id').range(start,start+499);
        if (from && to) query = query.gte('date',from).lte('date',to).is('deleted_at',null);
        const { data, error } = await query;
        if (error) throw error;
        rows.push(...data);
        if (data.length<500) return rows;
    }
}

const fmt2 = (v: unknown) => parseFloat(String(v || 0)).toFixed(2);
const fmt3 = (v: unknown) => parseFloat(String(v || 0)).toFixed(3);
const dir  = (v: unknown) => parseFloat(String(v || 0)) >= 0 ? 'jama' : 'nave (balance)';

Deno.serve(async (req) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status:405 });
    if (!CRON_SECRET || !GMAIL_USER || !GMAIL_PASS || !REPORT_TO || !REPORT_ORG_ID) {
        return new Response('Report service is not configured', { status:503 });
    }
    if (req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('Unauthorized', { status:401 });
    const type = new URL(req.url).searchParams.get('type') || 'daily';
    if (!['daily','weekly'].includes(type)) return new Response('Invalid report type', { status:400 });
    const { dateFrom, dateTo, todayIST } = reportPeriod(type);
    const reportTitle = `${type === 'daily' ? 'Daily' : 'Weekly'} Report — ${dateFrom}${dateFrom === dateTo ? '' : ' to ' + dateTo}`;
    const sheetLabel = type === 'daily' ? 'Day Transactions' : 'Week Transactions';
    let runId: string | undefined;
    let delivered = false;
    try {
    const { data: org, error: orgError } = await supabase.from('organizations').select('id,name').eq('id',REPORT_ORG_ID).single();
    if (orgError || !org) throw new Error('Report organization missing');
    // Unique period claim prevents two cron invocations from emailing twice.
    const { data: run, error: claimError } = await supabase.from('report_runs').insert({
        org_id:org.id, report_type:type, date_from:dateFrom, date_to:dateTo,
    }).select('id').single();
    if (claimError?.code === '23505') return new Response('This report period was already attempted; inspect report_runs', { status:409 });
    if (claimError) throw claimError;
    runId = run.id;
    const [allTxs, allCusts] = await Promise.all([
        readAll('transactions',org.id,dateFrom,dateTo), readAll('customers',org.id),
    ]);
    allTxs.sort((a,b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const custMap  = Object.fromEntries(allCusts.map(c => [c.id, c.name]));

    // ── Build Excel ──────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    // Sheet 1: Transactions for the period
    const txRows = allTxs.map(t => ({
        'Bill Number': t.bill_number || '',
                    'Date':           t.date,
        'Time':           t.time ? String(t.time).substring(0, 5) : '',
        'Customer':       custMap[t.customer_id] || '',
        'Category':       t.category,
        'Sub Type':       t.sub_type,
        'Unit':           t.type === 'CASH' ? '₹' : 'g',
        'Jama':           parseFloat(t.jama || 0) > 0 ? (t.type === 'CASH' ? fmt2(t.jama) : fmt3(t.jama)) : '',
        'Nave':           parseFloat(t.nave || 0) > 0 ? (t.type === 'CASH' ? fmt2(t.nave) : fmt3(t.nave)) : '',
        'Balance After':  t.type === 'CASH' ? fmt2(t.new_balance) : fmt3(t.new_balance),
        'Description':    t.description || '',
        'Added By':       t.added_by || '',
    }));
    const ws1 = XLSX.utils.json_to_sheet(txRows.length ? txRows : [{ Info: 'No transactions for this period' }]);
    ws1['!cols'] = [{ wch: 12 }, { wch: 7 }, { wch: 22 }, { wch: 10 }, { wch: 10 },
                    { wch: 5 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws1, sheetLabel);

    // Sheet 2: Summary by category
    const totMap: Record<string, { category: string; sub_type: string; type: string; jama: number; nave: number }> = {};
    for (const t of allTxs) {
        const key = `${t.category}_${t.sub_type}`;
        if (!totMap[key]) totMap[key] = { category: t.category, sub_type: t.sub_type, type: t.type, jama: 0, nave: 0 };
        totMap[key].jama += parseFloat(t.jama || 0);
        totMap[key].nave += parseFloat(t.nave || 0);
    }
    const summaryRows = Object.values(totMap).map(r => ({
        'Category':    r.category,
        'Sub Type':    r.sub_type,
        'Unit':        r.type === 'CASH' ? '₹' : 'g',
        'Total Jama':  r.type === 'CASH' ? fmt2(r.jama) : fmt3(r.jama),
        'Total Nave':  r.type === 'CASH' ? fmt2(r.nave) : fmt3(r.nave),
        'Net':         r.type === 'CASH' ? fmt2(r.jama - r.nave) : fmt3(r.jama - r.nave),
        'Direction':   (r.jama - r.nave) >= 0 ? 'jama' : 'nave (balance)',
    }));
    const ws2 = XLSX.utils.json_to_sheet(summaryRows.length ? summaryRows : [{ Info: 'No data' }]);
    ws2['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    // Sheet 3: All Customer Balances
    const custRows = allCusts.map(c => {
        const daysOverdue = c.due_date && c.due_date < todayIST
            ? Math.floor((new Date(todayIST).getTime() - new Date(c.due_date).getTime()) / 86400000)
            : null;
        return {
            'Customer':           c.name,
            'Mobile':             c.mobile,
            'Due Date':           c.due_date || '',
            'Days Overdue':       daysOverdue ?? '',
            'Retail Cash (₹)':    fmt2(c.retail_cash),
            'Retail Cash Dir':    dir(c.retail_cash),
            'Retail Gold (g)':    fmt3(c.retail_gold),
            'Retail Gold Dir':    dir(c.retail_gold),
            'Bullion Cash (₹)':   fmt2(c.bullion_cash),
            'Bullion Cash Dir':   dir(c.bullion_cash),
            'Bullion Gold (g)':   fmt3(c.bullion_gold),
            'Bullion Gold Dir':   dir(c.bullion_gold),
            'Bullion Silver (g)': fmt3(c.bullion_silver),
            'Bullion Silver Dir': dir(c.bullion_silver),
            'Silver Cash (₹)':    fmt2(c.silver_cash),
            'Silver Cash Dir':    dir(c.silver_cash),
            'Silver (g)':         fmt3(c.silver_silver),
            'Silver Dir':         dir(c.silver_silver),
            'Chit Cash (₹)':      fmt2(c.chit_cash),
            'Chit Cash Dir':      dir(c.chit_cash),
        };
    });
    const ws3 = XLSX.utils.json_to_sheet(custRows.length ? custRows : [{ Info: 'No customers' }]);
    ws3['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, ...Array(16).fill({ wch: 16 })];
    XLSX.utils.book_append_sheet(wb, ws3, 'Customer Balances');

    // Sheet 4: Overdue Customers (weekly only)
    if (type === 'weekly') {
        const overdueRows = allCusts
            .filter(c => c.due_date && c.due_date < todayIST)
            .map(c => ({
                'Customer':           c.name,
                'Mobile':             c.mobile,
                'Due Date':           c.due_date,
                'Days Overdue':       Math.floor((new Date(todayIST).getTime() - new Date(c.due_date).getTime()) / 86400000),
                'Bullion Cash (₹)':   fmt2(c.bullion_cash),
                'Bullion Cash Dir':   dir(c.bullion_cash),
                'Bullion Gold (g)':   fmt3(c.bullion_gold),
                'Bullion Silver (g)': fmt3(c.bullion_silver),
                'Retail Cash (₹)':    fmt2(c.retail_cash),
                'Chit Cash (₹)':      fmt2(c.chit_cash),
            }));
        const ws4 = XLSX.utils.json_to_sheet(overdueRows.length ? overdueRows : [{ Info: 'No overdue customers' }]);
        ws4['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, ...Array(6).fill({ wch: 16 })];
        XLSX.utils.book_append_sheet(wb, ws4, 'Overdue Customers');
    }

    // ── Excel buffer ─────────────────────────────────────────────────────────
    const excelBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const dateStr  = todayIST.replace(/-/g, '');
    const fileName = `oneledger_${type}_${dateStr}.xlsx`;

    // ── Email HTML body ──────────────────────────────────────────────────────
    const cashJama   = allTxs.filter(t => t.type === 'CASH').reduce((s, t) => s + parseFloat(t.jama || 0), 0);
    const cashNave   = allTxs.filter(t => t.type === 'CASH').reduce((s, t) => s + parseFloat(t.nave || 0), 0);
    const goldJama   = allTxs.filter(t => t.type === 'GOLD').reduce((s, t) => s + parseFloat(t.jama || 0), 0);
    const goldNave   = allTxs.filter(t => t.type === 'GOLD').reduce((s, t) => s + parseFloat(t.nave || 0), 0);
    const silverJama = allTxs.filter(t => t.type === 'SILVER').reduce((s, t) => s + parseFloat(t.jama || 0), 0);
    const silverNave = allTxs.filter(t => t.type === 'SILVER').reduce((s, t) => s + parseFloat(t.nave || 0), 0);
    const overdueList = allCusts.filter(c => c.due_date && c.due_date < todayIST);
    const cashNet    = cashJama - cashNave;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}
.wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.1)}
.hdr{background:#1a1a2e;color:#fff;padding:24px 28px}
.hdr h1{margin:0;font-size:20px;font-weight:700}
.hdr p{margin:4px 0 0;color:#9090b0;font-size:13px}
.sec{padding:20px 28px;border-bottom:1px solid #eee}
.sec h2{font-size:12px;color:#888;margin:0 0 14px;text-transform:uppercase;letter-spacing:.06em}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.stat{flex:1;min-width:110px;background:#f8f8f8;border-radius:8px;padding:12px 14px}
.sl{font-size:11px;color:#999;margin-bottom:4px}
.sv{font-size:15px;font-weight:700;color:#1a1a2e}
.g{color:#16a34a}.r{color:#dc2626}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{background:#f2f2f2;padding:8px 10px;text-align:left;color:#555;font-weight:600;font-size:11.5px}
td{padding:7px 10px;border-bottom:1px solid #f5f5f5;color:#333}
.ob{background:#fee2e2;color:#dc2626;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700}
.ft{padding:14px 28px;background:#f8f8f8;font-size:11px;color:#aaa;text-align:center}
</style></head><body><div class="wrap">
<div class="hdr"><h1>OneLedger Pro</h1><p>${reportTitle}</p></div>

<div class="sec">
<h2>Summary</h2>
<div class="stats">
  <div class="stat"><div class="sl">Transactions</div><div class="sv">${allTxs.length}</div></div>
  <div class="stat"><div class="sl">Cash Jama</div><div class="sv g">₹${fmt2(cashJama)}</div></div>
  <div class="stat"><div class="sl">Cash Nave</div><div class="sv r">₹${fmt2(cashNave)}</div></div>
  <div class="stat"><div class="sl">Net Cash</div><div class="sv ${cashNet >= 0 ? 'g' : 'r'}">₹${fmt2(Math.abs(cashNet))} ${cashNet >= 0 ? 'jama' : 'nave'}</div></div>
</div>
<div class="stats">
  <div class="stat"><div class="sl">Gold Jama</div><div class="sv g">${fmt3(goldJama)}g</div></div>
  <div class="stat"><div class="sl">Gold Nave</div><div class="sv r">${fmt3(goldNave)}g</div></div>
  <div class="stat"><div class="sl">Silver Jama</div><div class="sv g">${fmt3(silverJama)}g</div></div>
  <div class="stat"><div class="sl">Silver Nave</div><div class="sv r">${fmt3(silverNave)}g</div></div>
</div>
</div>

${overdueList.length > 0 ? `<div class="sec">
<h2>⚠ Overdue Customers (${overdueList.length})</h2>
<table><tr><th>Customer</th><th>Mobile</th><th>Due Date</th><th>Status</th></tr>
${overdueList.map(c => {
    const d = Math.floor((new Date(todayIST).getTime() - new Date(c.due_date).getTime()) / 86400000);
    return `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.mobile)}</td><td>${c.due_date}</td><td><span class="ob">${d}d overdue</span></td></tr>`;
}).join('')}
</table></div>` : ''}

<div class="sec">
<h2>${type === 'daily' ? "Today's" : "Week's"} Transactions${allTxs.length > 20 ? ` (showing first 20 of ${allTxs.length} — full list in Excel)` : ''}</h2>
${txRows.length > 0 ? `<table>
<tr><th>Date</th><th>Time</th><th>Customer</th><th>Category</th><th>Jama</th><th>Nave</th><th>By</th></tr>
${txRows.slice(0, 20).map(t => `<tr>
  <td>${escapeHtml(t['Date'])}</td><td>${escapeHtml(t['Time'])}</td><td>${escapeHtml(t['Customer'])}</td>
  <td>${escapeHtml(t['Category'])} ${escapeHtml(t['Sub Type'])}</td>
  <td class="g">${t['Jama'] ? t['Unit'] + t['Jama'] : ''}</td>
  <td class="r">${t['Nave'] ? t['Unit'] + t['Nave'] : ''}</td>
  <td>${escapeHtml(t['Added By'])}</td>
</tr>`).join('')}
</table>` : '<p style="color:#aaa;font-size:13px;margin:0">No transactions for this period.</p>'}
</div>

<div class="ft">
  Generated by OneLedger Pro &middot; ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST<br>
  Full data in attached Excel &middot; ${fileName}
</div>
</div></body></html>`;

    // ── Send via Gmail SMTP ──────────────────────────────────────────────────
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        connectionTimeout: 15000,
        socketTimeout: 30000,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    await transporter.sendMail({
        from:    `"OneLedger Pro Reports" <${GMAIL_USER}>`,
        to:      REPORT_TO,
        subject: `OneLedger Pro — ${reportTitle}`,
        html,
        attachments: [{
            filename:    fileName,
            content:     excelBuf,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }],
    });

    delivered = true;
    const { error: finishError } = await supabase.from('report_runs').update({ status:'sent', finished_at:new Date().toISOString() }).eq('id',runId);
    if (finishError) throw finishError;
    return Response.json({ ok:true, type, transactions:allTxs.length, file:fileName });
    } catch (_error) {
        if (runId && !delivered) await supabase.from('report_runs').update({
            status:'failed', finished_at:new Date().toISOString(), error:'Delivery failed or unconfirmed. Inspect function logs before manually retrying.',
        }).eq('id',runId);
        console.error('Report failed', { runId, delivered });
        return Response.json({ error: delivered ? 'Email sent but status update failed; do not resend automatically.' : 'Report delivery failed or unconfirmed.', runId }, { status:500 });
    }
});
