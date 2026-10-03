import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx';
import nodemailer from 'npm:nodemailer';

const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const GMAIL_USER  = Deno.env.get('GMAIL_USER')!;
const GMAIL_PASS  = Deno.env.get('GMAIL_PASS')!;
const REPORT_TO   = Deno.env.get('REPORT_TO')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const fmt2 = (v: unknown) => parseFloat(String(v || 0)).toFixed(2);
const fmt3 = (v: unknown) => parseFloat(String(v || 0)).toFixed(3);
const dir  = (v: unknown) => parseFloat(String(v || 0)) >= 0 ? 'jama' : 'nave (balance)';

Deno.serve(async (req) => {
    // Simple secret check — requests must include x-cron-secret header
    if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
        return new Response('Unauthorized', { status: 401 });
    }

    const url  = new URL(req.url);
    const type = url.searchParams.get('type') || 'daily'; // 'daily' | 'weekly'

    // ── IST-aware dates ──────────────────────────────────────────────────────
    const now       = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow    = new Date(now.getTime() + istOffset);
    const todayIST  = istNow.toISOString().split('T')[0];

    let dateFrom: string;
    let dateTo:   string;
    let reportTitle: string;
    let sheetLabel: string;

    if (type === 'daily') {
        dateFrom    = todayIST;
        dateTo      = todayIST;
        reportTitle = `Daily Report — ${todayIST}`;
        sheetLabel  = 'Today Transactions';
    } else {
        // Weekly: Mon–Sat of the week ending today (sent Sunday morning)
        const day = istNow.getDay(); // 0=Sun
        const mon = new Date(istNow);
        mon.setDate(istNow.getDate() - (day === 0 ? 6 : day - 1));
        const sat = new Date(mon);
        sat.setDate(mon.getDate() + 5);
        dateFrom    = mon.toISOString().split('T')[0];
        dateTo      = sat.toISOString().split('T')[0];
        reportTitle = `Weekly Report — ${dateFrom} to ${dateTo}`;
        sheetLabel  = 'Week Transactions';
    }

    // ── Fetch data ───────────────────────────────────────────────────────────
    const { data: orgs } = await supabase.from('organizations').select('id, name').limit(1);
    const org = orgs?.[0];
    if (!org) return new Response(JSON.stringify({ error: 'No org found' }), { status: 500 });

    const { data: txs } = await supabase
        .from('transactions')
        .select('*')
        .eq('org_id', org.id)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .order('time', { ascending: false });

    const { data: custs } = await supabase
        .from('customers')
        .select('*')
        .eq('org_id', org.id)
        .order('name');

    const allTxs   = txs   || [];
    const allCusts = custs || [];
    const custMap  = Object.fromEntries(allCusts.map(c => [c.id, c.name]));

    // ── Build Excel ──────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    // Sheet 1: Transactions for the period
    const txRows = allTxs.map(t => ({
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
    return `<tr><td>${c.name}</td><td>${c.mobile}</td><td>${c.due_date}</td><td><span class="ob">${d}d overdue</span></td></tr>`;
}).join('')}
</table></div>` : ''}

<div class="sec">
<h2>${type === 'daily' ? "Today's" : "Week's"} Transactions${allTxs.length > 20 ? ` (showing first 20 of ${allTxs.length} — full list in Excel)` : ''}</h2>
${txRows.length > 0 ? `<table>
<tr><th>Date</th><th>Time</th><th>Customer</th><th>Category</th><th>Jama</th><th>Nave</th><th>By</th></tr>
${txRows.slice(0, 20).map(t => `<tr>
  <td>${t['Date']}</td><td>${t['Time']}</td><td>${t['Customer']}</td>
  <td>${t['Category']} ${t['Sub Type']}</td>
  <td class="g">${t['Jama'] ? t['Unit'] + t['Jama'] : ''}</td>
  <td class="r">${t['Nave'] ? t['Unit'] + t['Nave'] : ''}</td>
  <td>${t['Added By']}</td>
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

    return new Response(
        JSON.stringify({ ok: true, type, transactions: allTxs.length, file: fileName }),
        { headers: { 'Content-Type': 'application/json' } },
    );
});
