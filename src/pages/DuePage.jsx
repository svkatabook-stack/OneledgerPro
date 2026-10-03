import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { Phone, CheckSquare, Square, AlertTriangle, Send, ArrowLeft, CalendarDays, User, X, Clock, Download } from 'lucide-react';
import './DuePage.css';

const fmt  = (v) => parseFloat(v || 0).toFixed(2);
const fmtG = (v) => parseFloat(v || 0).toFixed(3);
const n    = (v) => parseFloat(v || 0);

const getDaysFromToday = (dueDateStr) => {
    if (!dueDateStr) return null;
    const due = new Date(dueDateStr).setHours(0, 0, 0, 0);
    const now = new Date().setHours(0, 0, 0, 0);
    return Math.floor((due - now) / (1000 * 60 * 60 * 24));
};

const StatusBadge = ({ days }) => {
    if (days === null) return null;
    if (days < 0)  return <span className="overdue-badge status-red"><AlertTriangle size={11} style={{ marginRight: 3, verticalAlign: -2 }} />{Math.abs(days)}d overdue</span>;
    if (days === 0) return <span className="overdue-badge status-yellow"><Clock size={11} style={{ marginRight: 3, verticalAlign: -2 }} />Due today</span>;
    if (days <= 7)  return <span className="overdue-badge status-yellow"><Clock size={11} style={{ marginRight: 3, verticalAlign: -2 }} />In {days}d</span>;
    return <span className="overdue-badge" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}><Clock size={11} style={{ marginRight: 3, verticalAlign: -2 }} />In {days}d</span>;
};

// Fixed display order for category+type combinations — mirrors the Ledger tab order (CHIT excluded from Dashboard)
const CAT_TYPE_ORDER = [
    'RETAIL|CASH', 'RETAIL|GOLD',
    'BULLION|CASH', 'BULLION|GOLD', 'BULLION|SILVER',
    'SILVER|CASH',  'SILVER|SILVER',
];
const catTypeLabel = (cat, type) => {
    const c = { RETAIL:'Retail', BULLION:'Bullion', SILVER:'Silver', CHIT:'Chit' };
    const t = { CASH:'Cash', GOLD:'Gold', SILVER:'Silver' };
    return `${c[cat] || cat} ${t[type] || type}`;
};

const DuePage = () => {
    const { customers, transactions, updateCustomerDueDate } = useAppContext();
    const navigate = useNavigate();

    const [viewMode,     setViewMode]    = useState('customer');
    const [catTab,       setCatTab]      = useState('ALL');
    const [dashSubTab,   setDashSubTab]  = useState('ALL'); // RETAIL sub-filter: ALL | CASH | METAL
    const [custFilter,   setCustFilter]  = useState(null);
    const [custSearch,   setCustSearch]  = useState('');
    const [showCustDD,   setShowCustDD]  = useState(false);
    const [globalFilter, setGlobalFilter] = useState('ALL');
    const [excludedIds,  setExcludedIds] = useState(new Set());
    const [extendId,     setExtendId]    = useState(null);
    const [extendDate,   setExtendDate]  = useState('');
    const custRef = useRef(null);

    useEffect(() => {
        const handler = (e) => {
            if (custRef.current && !custRef.current.contains(e.target)) setShowCustDD(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Customer dropdown suggestions
    const custSuggestions = useMemo(() => {
        if (!custSearch) return customers.filter(c => c.due_date).slice(0, 8);
        const q = custSearch.toLowerCase();
        return customers.filter(c =>
            (c.name.toLowerCase().includes(q) || (c.mobile || '').includes(q))
        ).slice(0, 8);
    }, [customers, custSearch]);

    // Returns the relevant balance fields for a given category tab
    const catBals = (c, cat = 'ALL') => {
        if (cat === 'RETAIL')  return [n(c.retailCash),  n(c.retailGold)];
        if (cat === 'BULLION') return [n(c.bullionCash), n(c.bullionGold), n(c.bullionSilver)];
        if (cat === 'SILVER')  return [n(c.silverCash),  n(c.silverSilver)];
        if (cat === 'CHIT')    return [n(c.chitCash)];
        return [n(c.retailCash), n(c.retailGold), n(c.bullionCash), n(c.bullionGold),
                n(c.bullionSilver), n(c.silverCash), n(c.silverSilver), n(c.chitCash)];
    };

    // Global list — filtered by catTab (category) then by direction (YOU_GOT / YOU_GAVE)
    // Only includes customers who have a due date set.
    const globalList = useMemo(() => {
        return customers
            .filter(c => {
                if (!c.due_date) return false;
                const bals = catBals(c, catTab);
                const hasPositive = bals.some(v => v >  0.0001);
                const hasNegative = bals.some(v => v < -0.0001);
                if (globalFilter === 'YOU_GOT')  return hasPositive;
                if (globalFilter === 'YOU_GAVE') return hasNegative;
                return hasPositive || hasNegative;
            })
            .map(c => ({ ...c, days: getDaysFromToday(c.due_date) }))
            .sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
    }, [customers, globalFilter, catTab]);

    // Step 1: aggregate jama+nave per customer per category|type — expensive O(m) pass.
    // Depends ONLY on transactions so it does NOT rerun when UI tabs/filters change.
    const custTxMap = useMemo(() => {
        const map = {};
        transactions.forEach(tx => {
            if (!tx.cid || tx.deleted_at) return;
            const key = `${tx.category}|${tx.type}`;
            if (!map[tx.cid])      map[tx.cid] = {};
            if (!map[tx.cid][key]) map[tx.cid][key] = { jama: 0, nave: 0 };
            map[tx.cid][key].jama += n(tx.jama);
            map[tx.cid][key].nave += n(tx.nave);
        });
        return map;
    }, [transactions]); // only reruns when transactions change

    // Step 2: apply UI filters — cheap, reruns on tab/filter changes using pre-built map.
    const dashboardData = useMemo(() => {
        return customers
            .map(c => {
                const catData = custTxMap[c.id] || {};
                const rows = CAT_TYPE_ORDER
                    .map(key => {
                        const [category, type] = key.split('|');
                        if (catTab !== 'ALL' && category !== catTab) return null;
                        // Sub-tab filters per category
                        if (catTab === 'RETAIL'  && dashSubTab === 'CASH'   && type !== 'CASH')   return null;
                        if (catTab === 'RETAIL'  && dashSubTab === 'METAL'  && type !== 'GOLD')   return null;
                        if (catTab === 'BULLION' && dashSubTab === 'CASH'   && type !== 'CASH')   return null;
                        if (catTab === 'BULLION' && dashSubTab === 'GOLD'   && type !== 'GOLD')   return null;
                        if (catTab === 'BULLION' && dashSubTab === 'SILVER' && type !== 'SILVER') return null;
                        if (catTab === 'SILVER'  && dashSubTab === 'CASH'   && type !== 'CASH')   return null;
                        if (catTab === 'SILVER'  && dashSubTab === 'SILVER' && type !== 'SILVER') return null;
                        const { jama = 0, nave = 0 } = catData[key] || {};
                        const isCash = type === 'CASH';
                        const net = parseFloat((jama - nave).toFixed(isCash ? 2 : 3));
                        if (Math.abs(net) < 0.0001) return null;          // zero net — skip
                        if (globalFilter === 'YOU_GOT'  && net < 0) return null;
                        if (globalFilter === 'YOU_GAVE' && net > 0) return null;
                        return { category, type, isCash,
                                 jama: parseFloat(jama.toFixed(isCash ? 2 : 3)),
                                 nave: parseFloat(nave.toFixed(isCash ? 2 : 3)),
                                 net };
                    })
                    .filter(Boolean);
                if (rows.length === 0) return null;
                return { customer: c, rows };
            })
            .filter(Boolean)
            .sort((a, b) => a.customer.name.localeCompare(b.customer.name));
    }, [customers, custTxMap, catTab, dashSubTab, globalFilter]);

    const selectedCustomer = custFilter ? customers.find(c => c.id === custFilter.id) : null;

    // Shared WhatsApp URL builder — used by Customer view, Global view, and Dashboard.
    const getWhatsAppUrl = (c) => {
        const dir = (v) => v >= 0 ? 'jama' : 'nave (balance)';
        const parts = [];
        const add  = (val, label) => { const v = n(val); if (Math.abs(v) > 0.001)  parts.push(`${label}: ₹${fmt(Math.abs(v))} ${dir(v)}`); };
        const addG = (val, label) => { const v = n(val); if (Math.abs(v) > 0.0001) parts.push(`${label}: ${fmtG(Math.abs(v))}g ${dir(v)}`); };
        add(c.retailCash,    'Retail Cash');
        addG(c.retailGold,   'Retail Gold');
        add(c.bullionCash,   'Bullion Cash');
        addG(c.bullionGold,  'Bullion Gold');
        addG(c.bullionSilver,'Bullion Silver');
        add(c.silverCash,    'Silver Cash');
        addG(c.silverSilver, 'Silver');
        add(c.chitCash,      'Chit');
        const bals = parts.join('\n') || 'No outstanding balance';

        const last5 = transactions
            .filter(t => t.cid === c.id)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 5);
        let txLines = '';
        if (last5.length > 0) {
            const lines = last5.map((t, i) => {
                const amount = t.jama > 0 ? t.jama : t.nave;
                const label  = t.jama > 0 ? 'jama' : 'nave (balance)';
                const val    = t.type === 'CASH'
                    ? `₹${fmt(Math.abs(amount))}`
                    : `${fmtG(Math.abs(amount))}g`;
                const cat    = [t.category, t.sub_type].filter(Boolean).join(' ');
                return `${i + 1}. ${t.date} | ${cat} | ${val} ${label}`;
            });
            txLines = `\n\nLast 5 Transactions:\n${lines.join('\n')}`;
        }

        const text = `Dear customer,\nYour outstanding balance with us:\n${bals}${txLines}`;
        let mobile = (c.mobile || '').replace(/\D/g, '');
        if (!mobile.startsWith('91')) mobile = '91' + mobile;
        return `https://wa.me/${mobile}?text=${encodeURIComponent(text)}`;
    };

    const sendBulk = () => {
        const toSend = globalList.filter(c => !excludedIds.has(c.id));
        if (toSend.length === 0) return alert('Select at least one customer.');
        if (window.confirm(`Send WhatsApp to ${toSend.length} customers? Browser may block popups — will open first one.`)) {
            const target = toSend[0];
            window.open(getWhatsAppUrl(target), '_blank');
            setExcludedIds(prev => new Set(prev).add(target.id));
        }
    };

    const toggleAll = () => {
        if (excludedIds.size === globalList.length) setExcludedIds(new Set());
        else setExcludedIds(new Set(globalList.map(c => c.id)));
    };

    // ── Flat balance rows — one entry per category/subtype ───────────────────
    const getBalRows = (c, cat = 'ALL') => {
        const rows = [];
        const add = (raw, category, subtype, unit, isGrams) => {
            const v = n(raw);
            if (Math.abs(v) < 0.0001) return;
            rows.push({ direction: v > 0 ? 'You Got' : 'You Gave', category, subtype,
                        amount: parseFloat(Math.abs(v).toFixed(isGrams ? 3 : 2)), unit });
        };
        if (cat === 'ALL' || cat === 'RETAIL')  { add(c.retailCash,    'Retail',  'Cash',   '₹',       false); add(c.retailGold,    'Retail',  'Gold',   'g Gold',   true); }
        if (cat === 'ALL' || cat === 'BULLION') { add(c.bullionCash,   'Bullion', 'Cash',   '₹',       false); add(c.bullionGold,   'Bullion', 'Gold',   'g Gold',   true); add(c.bullionSilver, 'Bullion', 'Silver', 'g Silver', true); }
        if (cat === 'ALL' || cat === 'SILVER')  { add(c.silverCash,    'Silver',  'Cash',   '₹',       false); add(c.silverSilver,  'Silver',  'Silver', 'g Silver', true); }
        if (cat === 'ALL' || cat === 'CHIT')    { add(c.chitCash,      'Chit',    'Cash',   '₹',       false); }
        return rows;
    };

    // ── Shared CSV writer ─────────────────────────────────────────────────────
    const writeCSV = (rows, filename) => {
        const csv  = rows.map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Column headers — one row per balance entry for clean Excel filtering
    const CSV_HEADER = ['Customer', 'Mobile', 'Due Date', 'Status (Days)', 'Direction', 'Category', 'Sub-type', 'Amount', 'Unit'];

    const customerToRows = (c, days, cat = 'ALL') => {
        const dueStr    = c.due_date ? new Date(c.due_date).toLocaleDateString('en-IN') : '—';
        const statusStr = days === null ? '—' : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `In ${days}d`;
        const balRows   = getBalRows(c, cat);
        if (balRows.length === 0) return [[c.name, c.mobile, dueStr, statusStr, '—', '—', '—', '—', '—']];
        return balRows.map(b => [c.name, c.mobile, dueStr, statusStr, b.direction, b.category, b.subtype, b.amount, b.unit]);
    };

    // ── Export single customer ────────────────────────────────────────────────
    const exportCustomerCSV = (c) => {
        const days = getDaysFromToday(c.due_date);
        const rows = [CSV_HEADER, ...customerToRows(c, days, catTab)];
        const catSuffix = catTab !== 'ALL' ? `-${catTab.toLowerCase()}` : '';
        writeCSV(rows, `dues-${c.name.replace(/\s+/g, '-')}${catSuffix}-${new Date().toISOString().split('T')[0]}.csv`);
    };

    // ── Export global (current filter) ────────────────────────────────────────
    const exportCSV = () => {
        const dirLabel = globalFilter === 'YOU_GOT' ? 'YouGot' : globalFilter === 'YOU_GAVE' ? 'YouGave' : 'All';
        const catLabel = catTab !== 'ALL' ? `-${catTab.toLowerCase()}` : '';
        const dataRows = globalList.flatMap(c => customerToRows(c, c.days, catTab));
        writeCSV([CSV_HEADER, ...dataRows], `dues-${dirLabel}${catLabel}-${new Date().toISOString().split('T')[0]}.csv`);
    };

    // ── Dashboard export + bulk send ─────────────────────────────────────────
    const exportDashboardCSV = () => {
        const headers = ['Customer', 'Mobile', 'Category', 'Type', 'You Got (JAMA)', 'You Gave (NAVE)', 'Net Balance', 'CR/DR'];
        const rows = dashboardData.flatMap(({ customer: c, rows }) =>
            rows.map(r => [c.name, c.mobile, r.category, r.type, r.jama, r.nave, Math.abs(r.net), r.net >= 0 ? 'CR' : 'DR'])
        );
        writeCSV([headers, ...rows], `dashboard-${new Date().toISOString().split('T')[0]}.csv`);
    };

    const sendDashboard = () => {
        const toSend = dashboardData.filter(({ customer: c }) => !excludedIds.has(c.id));
        if (toSend.length === 0) return alert('Select at least one customer.');
        if (window.confirm(`Send WhatsApp to ${toSend.length} customer${toSend.length > 1 ? 's' : ''}? Browser will open the first one.`)) {
            window.open(getWhatsAppUrl(toSend[0].customer), '_blank');
            setExcludedIds(prev => new Set(prev).add(toSend[0].customer.id));
        }
    };

    const toggleDashAll = () => {
        const allIds = dashboardData.map(({ customer: c }) => c.id);
        if (allIds.every(id => excludedIds.has(id))) setExcludedIds(new Set());
        else setExcludedIds(new Set(allIds));
    };

    const handleExtend = () => {
        if (!extendDate) return;
        updateCustomerDueDate(extendId, extendDate);
        setExtendId(null);
        setExtendDate('');
    };

    // ── Balance row renderer ──────────────────────────────────────────────────
    const BalSection = ({ label, color, items }) => {
        if (items.length === 0) return null;
        return (
            <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color, marginBottom: '0.4rem' }}>{label}</div>
                <div className="due-balances">
                    {items.map((item, i) => (
                        <span key={i} className={`bal-tag ${item.cls}`}>{item.label}</span>
                    ))}
                </div>
            </div>
        );
    };

    const getBalSections = (c, cat = 'ALL') => {
        const youGot  = [];
        const youGave = [];
        const addCash = (val, tag) => { const v = n(val); if (v >  0.0001) youGot.push ({label:`${tag}₹${fmt(v)}`,cls:'tb-cash'}); if (v < -0.0001) youGave.push({label:`${tag}₹${fmt(Math.abs(v))}`,cls:'tb-cash'}); };
        const addGold = (val, tag) => { const v = n(val); if (v >  0.0001) youGot.push ({label:`${tag}${fmtG(v)}g Gold`,cls:'tb-gold'}); if (v < -0.0001) youGave.push({label:`${tag}${fmtG(Math.abs(v))}g Gold`,cls:'tb-gold'}); };
        const addSilv = (val, tag) => { const v = n(val); if (v >  0.0001) youGot.push ({label:`${tag}${fmtG(v)}g Silver`,cls:'tb-silver'}); if (v < -0.0001) youGave.push({label:`${tag}${fmtG(Math.abs(v))}g Silver`,cls:'tb-silver'}); };

        if (cat === 'ALL' || cat === 'RETAIL')  { addCash(c.retailCash, 'Retail ');   addGold(c.retailGold, 'Retail '); }
        if (cat === 'ALL' || cat === 'BULLION') { addCash(c.bullionCash,'Bullion ');  addGold(c.bullionGold,'Bullion '); addSilv(c.bullionSilver,'Bullion '); }
        if (cat === 'ALL' || cat === 'SILVER')  { addCash(c.silverCash, 'Silver ');   addSilv(c.silverSilver,'Silver '); }
        if (cat === 'ALL' || cat === 'CHIT')    { addCash(c.chitCash,   'Chit '); }
        return { youGot, youGave };
    };

    return (
        <div className="due-container animate-fade-in" style={{ paddingBottom: '90px' }}>

            {/* Header */}
            <div className="due-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}>
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2>Pending Dues</h2>
                        <p>
                            {viewMode === 'customer'
                                ? (custFilter ? custFilter.name : 'Select a customer')
                                : viewMode === 'dashboard'
                                ? `${dashboardData.length} customers with balance`
                                : `${globalList.length} ${globalFilter === 'YOU_GAVE' ? 'you gave' : globalFilter === 'YOU_GOT' ? 'you got' : 'total'}`}
                        </p>
                    </div>
                </div>
                {viewMode === 'global' && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={exportCSV}
                            disabled={globalList.length === 0}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.35rem',
                                padding: '0.45rem 0.9rem', borderRadius: '10px', fontSize: '0.82rem',
                                fontWeight: 600, cursor: 'pointer',
                                background: 'rgba(16,185,129,0.12)',
                                border: '1px solid rgba(16,185,129,0.35)',
                                color: '#10b981',
                            }}
                        >
                            <Download size={15} /> Export
                        </button>
                        <button className="bulk-send-btn" onClick={sendBulk} disabled={globalList.filter(c => !excludedIds.has(c.id)).length === 0}>
                            <Send size={16} /> Send ({globalList.filter(c => !excludedIds.has(c.id)).length})
                        </button>
                    </div>
                )}
                {viewMode === 'dashboard' && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={exportDashboardCSV}
                            disabled={dashboardData.length === 0}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.35rem',
                                padding: '0.45rem 0.9rem', borderRadius: '10px', fontSize: '0.82rem',
                                fontWeight: 600, cursor: 'pointer',
                                background: 'rgba(16,185,129,0.12)',
                                border: '1px solid rgba(16,185,129,0.35)',
                                color: '#10b981',
                            }}
                        >
                            <Download size={15} /> Export
                        </button>
                        <button className="bulk-send-btn" onClick={sendDashboard} disabled={dashboardData.filter(({ customer: c }) => !excludedIds.has(c.id)).length === 0}>
                            <Send size={16} /> Send ({dashboardData.filter(({ customer: c }) => !excludedIds.has(c.id)).length})
                        </button>
                    </div>
                )}
            </div>

            {/* View mode tabs */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[
                    { key: 'customer',  label: 'Customer' },
                    { key: 'global',    label: 'Global' },
                    { key: 'dashboard', label: '📊 Dashboard' },
                ].map(({ key, label }) => (
                    <button key={key} onClick={() => setViewMode(key)} style={{
                        padding: '0.45rem 1.1rem', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 600,
                        cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                        background: viewMode === key ? '#6366f1' : 'rgba(255,255,255,0.07)',
                        color: viewMode === key ? '#fff' : 'var(--text-secondary)',
                    }}>{label}</button>
                ))}
            </div>

            {/* Category tabs — same classification as Ledger */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {[
                    { key: 'ALL',     label: 'All',        color: '#6366f1' },
                    { key: 'RETAIL',  label: '🏪 Retail',  color: '#818cf8' },
                    { key: 'BULLION', label: '🥇 Bullion', color: '#f59e0b' },
                    { key: 'SILVER',  label: '🥈 Silver',  color: '#94a3b8' },
                ].map(({ key, label, color }) => (
                    <button
                        key={key}
                        onClick={() => { setCatTab(key); setExcludedIds(new Set()); setDashSubTab('ALL'); }}
                        style={{
                            padding: '0.35rem 0.85rem', borderRadius: '20px', fontSize: '0.8rem',
                            fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                            border: catTab === key ? 'none' : `1px solid rgba(255,255,255,0.08)`,
                            background: catTab === key ? color : 'rgba(255,255,255,0.05)',
                            color: catTab === key ? '#fff' : 'var(--text-secondary)',
                        }}
                    >{label}</button>
                ))}
            </div>

            {/* ── CUSTOMER VIEW ─────────────────────────────────────────────── */}
            {viewMode === 'customer' && (
                <>
                    {/* Customer search */}
                    <div ref={custRef} style={{ position: 'relative' }}>
                        {custFilter ? (
                            <div className="tx-cust-chip">
                                <User size={13} />
                                <span>{custFilter.name}</span>
                                <button onClick={() => { setCustFilter(null); setCustSearch(''); }} className="tx-cust-chip-x"><X size={12} /></button>
                            </div>
                        ) : (
                            <div className={`search-bar tx-cust-search ${showCustDD ? 'focused' : ''}`} style={{ marginBottom: 0 }}>
                                <User size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                <input
                                    type="text"
                                    placeholder="Search customer by name or mobile..."
                                    value={custSearch}
                                    onChange={e => { setCustSearch(e.target.value); setShowCustDD(true); }}
                                    onFocus={() => setShowCustDD(true)}
                                />
                            </div>
                        )}
                        {showCustDD && !custFilter && (
                            <div className="tx-cust-dropdown glass-panel">
                                {custSuggestions.length === 0 ? (
                                    <div className="tx-cust-dd-empty">No customers found</div>
                                ) : custSuggestions.map(c => (
                                    <button key={c.id} className="tx-cust-dd-row"
                                        onMouseDown={e => { e.preventDefault(); setCustFilter({ id: c.id, name: c.name }); setCustSearch(''); setShowCustDD(false); }}>
                                        <span className="tx-cust-dd-name">{c.name}</span>
                                        <span className="tx-cust-dd-mob">{c.mobile}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {!custFilter ? (
                        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📅</div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Select a customer to view their dues</div>
                        </div>
                    ) : selectedCustomer && (
                        <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: '14px' }}>
                            {/* Due date row */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                <div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>Due Date</div>
                                    {selectedCustomer.due_date ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                            <span style={{ fontWeight: 700, fontSize: '1rem' }}>
                                                {new Date(selectedCustomer.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </span>
                                            <StatusBadge days={getDaysFromToday(selectedCustomer.due_date)} />
                                        </div>
                                    ) : (
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No due date set</span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <a href={getWhatsAppUrl(selectedCustomer)} target="_blank" rel="noopener noreferrer" className="wa-icon-btn" title="Send WhatsApp">
                                        <Phone size={16} />
                                    </a>
                                    <button className="wa-icon-btn" title="Set / extend due date"
                                        onClick={() => { setExtendId(selectedCustomer.id); setExtendDate(selectedCustomer.due_date || ''); }}
                                        style={{ background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.35)', color: '#a5b4fc' }}>
                                        <CalendarDays size={16} />
                                    </button>
                                    <button className="wa-icon-btn" title="Export CSV"
                                        onClick={() => exportCustomerCSV(selectedCustomer)}
                                        style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.35)', color: '#10b981' }}>
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Balance sections */}
                            {(() => {
                                const { youGot, youGave } = getBalSections(selectedCustomer, catTab);
                                return (
                                    <>
                                        <BalSection label="You Gave  ·  Customer owes shop" color="#ef4444" items={youGave} />
                                        <BalSection label="You Got  ·  Shop holds for customer" color="#10b981" items={youGot} />
                                        {youGot.length === 0 && youGave.length === 0 && (
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No outstanding balances for this category.</div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </>
            )}

            {/* ── GLOBAL VIEW ───────────────────────────────────────────────── */}
            {viewMode === 'global' && (
                <>
                    {/* Filter tabs */}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {[
                            { key: 'ALL',      label: 'All',      color: '#6366f1' },
                            { key: 'YOU_GAVE', label: 'You Gave', color: '#ef4444' },
                            { key: 'YOU_GOT',  label: 'You Got',  color: '#10b981' },
                        ].map(({ key, label, color }) => (
                            <button key={key} onClick={() => { setGlobalFilter(key); setExcludedIds(new Set()); }} style={{
                                padding: '0.4rem 1rem', borderRadius: '20px', fontSize: '0.82rem',
                                fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                                background: globalFilter === key ? color : 'rgba(255,255,255,0.07)',
                                color: globalFilter === key ? '#fff' : 'var(--text-secondary)',
                            }}>{label}</button>
                        ))}
                    </div>

                    <div className="table-container glass-panel" style={{ padding: 0 }}>
                        <table className="ui-table due-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 36, cursor: 'pointer' }} onClick={toggleAll}>
                                        {excludedIds.size === globalList.length && globalList.length > 0
                                            ? <Square size={17} className="text-muted" />
                                            : <CheckSquare size={17} className="text-blue" />}
                                    </th>
                                    <th>Customer</th>
                                    <th>You Gave</th>
                                    <th>You Got</th>
                                    <th>Due Date</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {globalList.length === 0 ? (
                                    <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No dues found.</td></tr>
                                ) : globalList.map(c => {
                                    const { youGot, youGave } = getBalSections(c, catTab);
                                    const isExcluded = excludedIds.has(c.id);
                                    return (
                                        <tr key={c.id} className={isExcluded ? 'row-excluded' : ''}>
                                            <td onClick={() => {
                                                setExcludedIds(prev => { const s = new Set(prev); s.has(c.id) ? s.delete(c.id) : s.add(c.id); return s; });
                                            }} style={{ cursor: 'pointer' }}>
                                                {isExcluded ? <Square size={17} className="text-muted" /> : <CheckSquare size={17} className="text-blue" />}
                                            </td>
                                            <td>
                                                <div style={{ fontWeight: 600 }}>{c.name}</div>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.mobile}</div>
                                            </td>
                                            <td>
                                                <div className="due-balances">
                                                    {globalFilter !== 'YOU_GOT' && youGave.length > 0
                                                        ? youGave.map((b, i) => <span key={i} className={`bal-tag ${b.cls}`}>{b.label}</span>)
                                                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>—</span>}
                                                </div>
                                            </td>
                                            <td>
                                                <div className="due-balances">
                                                    {globalFilter !== 'YOU_GAVE' && youGot.length > 0
                                                        ? youGot.map((b, i) => <span key={i} className={`bal-tag ${b.cls}`}>{b.label}</span>)
                                                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>—</span>}
                                                </div>
                                            </td>
                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                                                    {new Date(c.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </div>
                                                <StatusBadge days={c.days} />
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                    <a href={getWhatsAppUrl(c)} target="_blank" rel="noopener noreferrer"
                                                        className={`wa-icon-btn ${isExcluded ? 'disabled' : ''}`}
                                                        onClick={e => { if (isExcluded) e.preventDefault(); else setExcludedIds(prev => new Set(prev).add(c.id)); }}>
                                                        <Phone size={15} />
                                                    </a>
                                                    <button className="wa-icon-btn" title="Extend due date"
                                                        onClick={() => { setExtendId(c.id); setExtendDate(c.due_date || ''); }}
                                                        style={{ background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.35)', color: '#a5b4fc' }}>
                                                        <CalendarDays size={15} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* ── DASHBOARD VIEW — JAMA / NAVE / Net per category for every customer ── */}
            {viewMode === 'dashboard' && (
                <>
                    {/* Direction filter */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {[
                            { key: 'ALL',      label: 'All',      color: '#6366f1' },
                            { key: 'YOU_GAVE', label: 'You Gave', color: '#ef4444' },
                            { key: 'YOU_GOT',  label: 'You Got',  color: '#10b981' },
                        ].map(({ key, label, color }) => (
                            <button key={key} onClick={() => setGlobalFilter(key)} style={{
                                padding: '0.4rem 1rem', borderRadius: '20px', fontSize: '0.82rem',
                                fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                                background: globalFilter === key ? color : 'rgba(255,255,255,0.07)',
                                color: globalFilter === key ? '#fff' : 'var(--text-secondary)',
                            }}>{label}</button>
                        ))}
                    </div>

                    {/* Sub-tabs — shown when a specific category is selected */}
                    {(catTab === 'RETAIL' || catTab === 'BULLION' || catTab === 'SILVER') && (() => {
                        const subOpts =
                            catTab === 'RETAIL'  ? [{ key:'ALL', label:'All' }, { key:'CASH', label:'Cash' }, { key:'METAL', label:'Metal (Gold)' }] :
                            catTab === 'BULLION' ? [{ key:'ALL', label:'All' }, { key:'CASH', label:'Cash' }, { key:'GOLD', label:'Gold' }, { key:'SILVER', label:'Silver' }] :
                          /* SILVER */             [{ key:'ALL', label:'All' }, { key:'CASH', label:'Cash' }, { key:'SILVER', label:'Silver' }];
                        const activeColor = catTab === 'BULLION' ? '#f59e0b' : catTab === 'SILVER' ? '#94a3b8' : '#818cf8';
                        return (
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                {subOpts.map(({ key, label }) => (
                                    <button key={key} onClick={() => setDashSubTab(key)} style={{
                                        padding: '0.3rem 0.8rem', borderRadius: '16px', fontSize: '0.78rem',
                                        fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                                        border: dashSubTab === key ? 'none' : '1px solid rgba(255,255,255,0.1)',
                                        background: dashSubTab === key ? activeColor : 'rgba(255,255,255,0.04)',
                                        color: dashSubTab === key ? '#fff' : 'var(--text-secondary)',
                                    }}>{label}</button>
                                ))}
                            </div>
                        );
                    })()}

                    <div className="table-container glass-panel" style={{ padding: 0 }}>
                        <table className="ui-table due-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 36, cursor: 'pointer' }} onClick={toggleDashAll}>
                                        {dashboardData.every(({ customer: c }) => excludedIds.has(c.id)) && dashboardData.length > 0
                                            ? <Square size={17} className="text-muted" />
                                            : <CheckSquare size={17} className="text-blue" />}
                                    </th>
                                    <th>Category</th>
                                    <th className="text-green">You Got</th>
                                    <th className="text-red">You Gave</th>
                                    <th>Net Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dashboardData.length === 0 ? (
                                    <tr><td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No outstanding balances found.</td></tr>
                                ) : dashboardData.map(({ customer: c, rows }) => {
                                    const fmtV = (type, val) => type === 'CASH' ? `₹${fmt(val)}` : `${fmtG(val)}g`;
                                    return (
                                        <React.Fragment key={c.id}>
                                            {/* Customer header row */}
                                            <tr style={{ background: 'rgba(99,102,241,0.10)', borderTop: '1px solid rgba(99,102,241,0.25)', opacity: excludedIds.has(c.id) ? 0.45 : 1 }}>
                                                <td style={{ paddingLeft: '0.6rem', cursor: 'pointer' }} onClick={() => setExcludedIds(prev => { const s = new Set(prev); s.has(c.id) ? s.delete(c.id) : s.add(c.id); return s; })}>
                                                    {excludedIds.has(c.id) ? <Square size={15} className="text-muted" /> : <CheckSquare size={15} className="text-blue" />}
                                                </td>
                                                <td colSpan="3" style={{ padding: '0.55rem 0.75rem' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{c.name}</span>
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.mobile}</span>
                                                        {c.due_date && <StatusBadge days={getDaysFromToday(c.due_date)} />}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '0.55rem 0.75rem' }}>
                                                    <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                                                        <a href={getWhatsAppUrl(c)} target="_blank" rel="noopener noreferrer"
                                                            className="wa-icon-btn" title="Send WhatsApp reminder">
                                                            <Phone size={13} />
                                                        </a>
                                                        <button className="wa-icon-btn" title="Set / extend due date"
                                                            onClick={() => { setExtendId(c.id); setExtendDate(c.due_date || ''); }}
                                                            style={{ background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.35)', color: '#a5b4fc' }}>
                                                            <CalendarDays size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                            {/* One row per non-zero category+type — only numbers carry colour */}
                                            {rows.map((row, i) => (
                                                <tr key={i} style={{ opacity: excludedIds.has(c.id) ? 0.45 : 1 }}>
                                                    <td />
                                                    <td style={{ paddingLeft: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                                        {catTypeLabel(row.category, row.type)}
                                                    </td>
                                                    <td style={{ fontWeight: 600, fontSize: '0.83rem', color: '#10b981' }}>
                                                        {row.jama > 0.0001 ? fmtV(row.type, row.jama) : '—'}
                                                    </td>
                                                    <td style={{ fontWeight: 600, fontSize: '0.83rem', color: '#ef4444' }}>
                                                        {row.nave > 0.0001 ? fmtV(row.type, row.nave) : '—'}
                                                    </td>
                                                    <td style={{ fontWeight: 700, fontSize: '0.83rem', color: row.net >= 0 ? '#10b981' : '#ef4444' }}>
                                                        {fmtV(row.type, Math.abs(row.net))} {row.net >= 0 ? 'CR' : 'DR'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* Extend / Set Due Date Modal */}
            {extendId && (() => {
                const cust = customers.find(c => c.id === extendId);
                return (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
                        onClick={() => setExtendId(null)}>
                        <div className="glass-panel" onClick={e => e.stopPropagation()}
                            style={{ width: '100%', maxWidth: '360px', padding: '1.5rem', borderRadius: '18px' }}>
                            <h3 style={{ margin: '0 0 0.25rem' }}>Set Due Date</h3>
                            <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{cust?.name}</p>
                            <div style={{ marginBottom: '1.25rem' }}>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>Due Date</label>
                                <input
                                    type="date"
                                    value={extendDate}
                                    onChange={e => setExtendDate(e.target.value)}
                                    style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'inherit', fontSize: '1rem' }}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <button onClick={() => setExtendId(null)}
                                    style={{ flex: 1, padding: '0.6rem', borderRadius: '10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>
                                    Cancel
                                </button>
                                <button onClick={handleExtend} disabled={!extendDate}
                                    style={{ flex: 1, padding: '0.6rem', borderRadius: '10px', background: extendDate ? '#6366f1' : 'rgba(99,102,241,0.3)', border: 'none', color: '#fff', cursor: extendDate ? 'pointer' : 'default', fontWeight: 600 }}>
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default DuePage;
