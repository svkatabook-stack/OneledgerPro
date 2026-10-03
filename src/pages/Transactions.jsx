import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { Search, Camera, Trash2, ArrowLeft, Download, TrendingUp, TrendingDown, X, User } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import './Transactions.css';
import './Customers.css';
import '../components/TransactionPopup.css';

const fmt  = (v) => parseFloat(v || 0).toFixed(2);
const fmtG = (v) => parseFloat(v || 0).toFixed(2);
const isGramsType = (t) => t.type === 'GOLD' || t.type === 'SILVER';

// ── Category tab config ────────────────────────────────────────────────────────
const TABS = [
    { key: 'ALL',     label: 'All' },
    { key: 'RETAIL',  label: 'Retail',  subs: ['ALL', 'CASH', 'METAL'] },
    { key: 'BULLION', label: 'Bullion', subs: ['ALL', 'CASH', 'GOLD', 'SILVER'] },
    { key: 'SILVER',  label: 'Silver',  subs: ['ALL', 'CASH', 'SILVER'] },
    { key: 'CHIT',    label: 'Chit' },
];

// sub-type sheets config per category for customer export
const EXPORT_SHEETS = {
    RETAIL:  [
        { key: 'CASH',  label: 'Cash',  isGrams: false, typeFilter: (t) => t.sub_type === 'CASH' },
        { key: 'METAL', label: 'Metal', isGrams: true,  typeFilter: (t) => t.sub_type === 'METAL' },
    ],
    BULLION: [
        { key: 'CASH',   label: 'Cash',   isGrams: false, typeFilter: (t) => t.sub_type === 'CASH' },
        { key: 'GOLD',   label: 'Gold',   isGrams: true,  typeFilter: (t) => t.type === 'GOLD' && t.sub_type !== 'CASH' },
        { key: 'SILVER', label: 'Silver', isGrams: true,  typeFilter: (t) => t.type === 'SILVER' },
    ],
    SILVER: [
        { key: 'CASH',   label: 'Cash',   isGrams: false, typeFilter: (t) => t.sub_type === 'CASH' },
        { key: 'SILVER', label: 'Silver', isGrams: true,  typeFilter: (t) => t.sub_type === 'SILVER' || t.sub_type === 'METAL' },
    ],
    CHIT: [
        { key: 'CASH', label: 'Cash', isGrams: false, typeFilter: () => true },
    ],
};

const matchesTab = (t, tab, sub) => {
    if (tab === 'ALL') return true;
    if (t.category !== tab) return false;
    if (!sub || sub === 'ALL') return true;
    return (t.sub_type || '').toUpperCase() === sub;
};

const txAmount = (t) => {
    const isGrams = isGramsType(t);
    const val = t.jama > 0 ? t.jama : t.nave;
    return isGrams ? `${fmtG(val)}g` : `₹${fmt(val)}`;
};

const balFmt = (t) => {
    const isGrams = isGramsType(t);
    return isGrams ? (v) => `${fmtG(v)}g` : (v) => `₹${fmt(v)}`;
};

// ── Build customer statement sheets ───────────────────────────────────────────
const buildCustomerSheets = (custTxs, categories) => {
    const sheets = [];

    categories.forEach(catKey => {
        const catTxs = custTxs.filter(t => t.category === catKey);
        if (catTxs.length === 0) return;

        const sheetDefs = EXPORT_SHEETS[catKey] || [];
        sheetDefs.forEach(({ key, label, isGrams, typeFilter }) => {
            const rows = catTxs
                .filter(typeFilter)
                .sort((a, b) => a.createdAt - b.createdAt);

            if (rows.length === 0) return;

            // Compute running balance
            let running = 0;
            const unit  = isGrams ? 'g' : '₹';
            const gotH  = isGrams ? `You GOT (${unit})` : `You GOT (${unit})`;
            const gaveH = isGrams ? `You GAVE (${unit})` : `You GAVE (${unit})`;
            const balH  = `Balance (${unit})`;

            const data = rows.map(t => {
                const got  = parseFloat(t.jama || 0);
                const gave = parseFloat(t.nave || 0);
                running += got - gave;
                const row = {
                    'Date':     t.date,
                    'Time':     t.time ? t.time.substring(0, 5) : '',
                    [gotH]:     got  > 0 ? (isGrams ? fmtG(got)  : fmt(got))  : '',
                    [gaveH]:    gave > 0 ? (isGrams ? fmtG(gave) : fmt(gave)) : '',
                    [balH]:     isGrams ? fmtG(running) : fmt(running),
                    'Note':     t.description || '',
                };
                if (!isGrams && t.bill_amount > 0) row['Bill Amount (₹)'] = fmt(t.bill_amount);
                if (catKey === 'CHIT' && t.chit_scheme) row['Scheme'] = t.chit_scheme;
                return row;
            });

            // Summary row
            const totalGot  = rows.reduce((s, t) => s + parseFloat(t.jama || 0), 0);
            const totalGave = rows.reduce((s, t) => s + parseFloat(t.nave || 0), 0);
            const net       = totalGot - totalGave;
            data.push({
                'Date': 'TOTAL',
                'Time': '',
                [gotH]:  isGrams ? fmtG(totalGot)  : fmt(totalGot),
                [gaveH]: isGrams ? fmtG(totalGave) : fmt(totalGave),
                [balH]:  isGrams ? fmtG(net)       : fmt(net),
                'Note':  '',
            });

            sheets.push({ name: `${catKey} · ${label}`, data });
        });
    });

    return sheets;
};

// ── Component ─────────────────────────────────────────────────────────────────
const Transactions = () => {
    const { transactions, customers, deleteTransaction, deletedTransactions, authSession, orgId } = useAppContext();
    const navigate = useNavigate();

    // Top-level view: 'customer' | 'global'
    const [viewMode,   setViewMode]   = useState('customer');

    const [activeTab,  setActiveTab]  = useState('ALL');
    const [activeSub,  setActiveSub]  = useState('ALL');
    const [custFilter, setCustFilter] = useState(null);
    const [custSearch, setCustSearch] = useState('');
    const [showCustDD, setShowCustDD] = useState(false);
    const custRef = useRef(null);

    // Global view state — mirrors customer tab logic (same tabs + sub-pills)
    const [globalSearch,  setGlobalSearch]  = useState('');
    const [globalTab,     setGlobalTab]     = useState('ALL');
    const [globalSub,     setGlobalSub]     = useState('ALL');

    const [dateFrom, setDateFrom] = useState('');
    const [dateTo,   setDateTo]   = useState('');

    // Delete confirmation modal state
    const [pendingDeleteId, setPendingDeleteId] = useState(null);
    const [deleteInput,     setDeleteInput]     = useState('');

    // Recently deleted state
    const [deletedTxs,     setDeletedTxs]     = useState([]);
    const [deletedLoading, setDeletedLoading] = useState(false);
    const [lightboxImages, setLightboxImages] = useState(null); // null | array of {url}

    const isOwner          = authSession?.role === 'owner' || authSession?.role === 'super-admin';
    const isRestrictedView = authSession?.role === 'staff' || authSession?.role === 'view';

    // For staff/view: only show last 24h transactions (pre-filter before enrichment)
    const baseTransactions = useMemo(() => {
        if (!isRestrictedView) return transactions;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        return transactions.filter(t => t.createdAt && t.createdAt >= cutoff);
    }, [transactions, isRestrictedView]);

    // Close customer dropdown on outside click
    useEffect(() => {
        const handler = (e) => {
            if (custRef.current && !custRef.current.contains(e.target)) setShowCustDD(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Load recently deleted transactions when that view is activated
    useEffect(() => {
        if (viewMode !== 'deleted' || !isOwner) return;

        // Always show local cache immediately — works offline and when RLS blocks UPDATE
        const localRows = deletedTransactions.map(tx => ({
            ...tx,
            customerName: customerMap[tx.cid]?.name || 'Unknown',
        }));
        setDeletedTxs(localRows);
        setDeletedLoading(false);

        // If Supabase is available, also try to fetch (shows entries deleted from other devices)
        if (!orgId) return;
        supabase
            .from('transactions')
            .select('*')
            .eq('org_id', orgId)
            .not('deleted_at', 'is', null)
            .order('deleted_at', { ascending: false })
            .limit(100)
            .then(({ data, error }) => {
                if (error || !data || data.length === 0) return; // keep local rows on error/empty
                setDeletedTxs(data.map(tx => ({
                    id: tx.id, cid: tx.customer_id,
                    date: tx.date, time: tx.time,
                    category: tx.category, sub_type: tx.sub_type, type: tx.type,
                    jama: parseFloat(tx.jama || 0), nave: parseFloat(tx.nave || 0),
                    added_by: tx.added_by, deleted_at: tx.deleted_at,
                    customerName: customerMap[tx.customer_id]?.name || 'Unknown',
                })));
            })
            .catch(() => {}); // silently keep local rows on network error
    }, [viewMode, orgId, deletedTransactions]);

    // Build a customer ID → {name, mobile} map once — O(n) instead of O(n×m) per transaction
    const customerMap = useMemo(() => {
        const map = {};
        customers.forEach(c => { map[c.id] = { name: c.name, mobile: c.mobile || '' }; });
        return map;
    }, [customers]);

    // Enrich transactions — direct map lookup instead of .find() per transaction
    // Uses baseTransactions (24h-filtered for staff/view, full set for owner)
    const enriched = useMemo(() =>
        baseTransactions.map(t => {
            const c = customerMap[t.cid];
            return { ...t, customerName: c?.name || 'Unknown', customerMobile: c?.mobile || '' };
        }),
    [baseTransactions, customerMap]);

    // Customer dropdown suggestions
    const custSuggestions = useMemo(() => {
        if (!custSearch) return customers.slice(0, 8);
        const q = custSearch.toLowerCase();
        return customers.filter(c =>
            c.name.toLowerCase().includes(q) || (c.mobile || '').includes(q)
        ).slice(0, 8);
    }, [customers, custSearch]);

    // Filter
    const filtered = useMemo(() => {
        let list = enriched.filter(t => matchesTab(t, activeTab, activeSub));
        if (custFilter) list = list.filter(t => t.cid === custFilter.id);
        if (dateFrom) list = list.filter(t => t.date >= dateFrom);
        if (dateTo)   list = list.filter(t => t.date <= dateTo);
        return [...list].sort((a, b) => a.createdAt - b.createdAt);
    }, [enriched, activeTab, activeSub, custFilter, dateFrom, dateTo]);

    // Stats
    const tabStats = useMemo(() => {
        const base = enriched.filter(t => {
            if (!matchesTab(t, activeTab, activeSub)) return false;
            if (custFilter && t.cid !== custFilter.id) return false;
            if (dateFrom && t.date < dateFrom) return false;
            if (dateTo   && t.date > dateTo)   return false;
            return true;
        });
        let cashGot = 0, cashGave = 0;
        let goldGot = 0, goldGave = 0;
        let silverGot = 0, silverGave = 0;
        let metalGot = 0, metalGave = 0;

        base.forEach(t => {
            const got  = parseFloat(t.jama  || 0);
            const gave = parseFloat(t.nave  || 0);
            const g    = parseFloat(t.grams || 0);
            if (t.category === 'BULLION' && t.type === 'GOLD') {
                goldGot += got; goldGave += gave;
            } else if ((t.category === 'BULLION' || t.category === 'SILVER') && t.type === 'SILVER') {
                // BULLION·SILVER and SILVER·SILVER both track grams in silverGot/silverGave
                silverGot += got; silverGave += gave;
            } else if (t.sub_type === 'METAL') {
                // grams is the metal weight; direction determined by jama/nave
                if (got > 0) metalGot += g; else metalGave += g;
            } else {
                cashGot += got; cashGave += gave;
            }
        });

        return {
            cashGot, cashGave, cashNet: cashGot - cashGave,
            goldGot, goldGave, goldNet: goldGot - goldGave,
            silverGot, silverGave, silverNet: silverGot - silverGave,
            metalGot, metalGave, metalNet: metalGot - metalGave,
        };
    }, [enriched, activeTab, activeSub, custFilter, dateFrom, dateTo]);

    // ── Global Export ──────────────────────────────────────────────────────────
    const handleGlobalExport = () => {
        const today = new Date().toISOString().slice(0, 10);
        const rupeeTxs = enriched.filter(t =>
            t.category !== 'BULLION' &&
            !(t.category === 'SILVER' && t.sub_type === 'SILVER')
        );
        const sheet1 = rupeeTxs.map(t => ({
            'Date': t.date, 'Time': t.time, 'Category': t.category || '',
            'Sub-type': t.sub_type || '', 'Chit Scheme': t.chit_scheme || '',
            'Customer': t.customerName, 'Mobile': t.customerMobile,
            'YOU GOT (₹)': t.jama > 0 ? fmt(t.jama) : '',
            'YOU GAVE (₹)': t.nave > 0 ? fmt(t.nave) : '',
            'Bill Amount (₹)': t.bill_amount ? fmt(t.bill_amount) : '',
            'Grams': t.grams ? fmtG(t.grams) : '',
            'Description': t.description || '', 'Added By': t.added_by || '',
            'Curr Balance': t.currentBalance !== undefined ? fmt(t.currentBalance) : '',
            'New Balance':  t.newBalance     !== undefined ? fmt(t.newBalance)     : '',
        }));

        const gramsTxs = enriched.filter(t =>
            t.category === 'BULLION' ||
            ((t.category === 'RETAIL' || t.category === 'SILVER') && t.sub_type === 'METAL') ||
            (t.category === 'SILVER' && t.sub_type === 'SILVER')
        );
        const sheet2 = gramsTxs.map(t => ({
            'Date': t.date, 'Time': t.time, 'Category': t.category || '',
            'Metal Type': t.metal_type || (t.type === 'GOLD' ? 'GOLD' : t.type === 'SILVER' ? 'SILVER' : ''),
            'Customer': t.customerName, 'Mobile': t.customerMobile,
            'YOU GOT (g)': t.jama > 0 ? fmtG(t.jama) : '',
            'YOU GAVE (g)': t.nave > 0 ? fmtG(t.nave) : '',
            'Bill Amount (₹)': t.bill_amount ? fmt(t.bill_amount) : '',
            'Description': t.description || '', 'Added By': t.added_by || '',
        }));

        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.json_to_sheet(sheet1);
        XLSX.utils.book_append_sheet(wb, ws1, 'Rupee Transactions');
        const ws2 = XLSX.utils.json_to_sheet(sheet2);
        XLSX.utils.book_append_sheet(wb, ws2, 'Gold-Silver Grams');
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        saveAs(new Blob([buf], { type: 'application/octet-stream' }), `OneLedger_Ledger_${today}.xlsx`);
    };

    // ── Customer Statement Export ──────────────────────────────────────────────
    const handleCustomerExport = () => {
        if (!custFilter) return;
        const today = new Date().toISOString().slice(0, 10);
        const custTxs = enriched
            .filter(t => t.cid === custFilter.id)
            .sort((a, b) => a.createdAt - b.createdAt);

        // Decide which categories to export
        const cats = activeTab === 'ALL'
            ? ['RETAIL', 'BULLION', 'SILVER', 'CHIT']
            : [activeTab];

        const sheetDefs = buildCustomerSheets(custTxs, cats);

        if (sheetDefs.length === 0) {
            alert('No transactions found for this customer.');
            return;
        }

        const wb = XLSX.utils.book_new();
        sheetDefs.forEach(({ name, data }) => {
            const ws = XLSX.utils.json_to_sheet(data);
            // Bold the last (total) row by setting a wide col
            ws['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 28 }, { wch: 14 }];
            XLSX.utils.book_append_sheet(wb, ws, name);
        });

        const safeName = custFilter.name.replace(/[^a-z0-9]/gi, '_');
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Statement_${safeName}_${today}.xlsx`);
    };

    // Global view pagination — start at 200 rows, "Load More" adds 200
    const [globalDisplayLimit, setGlobalDisplayLimit] = useState(200);

    // Reset to page 1 whenever any global filter changes
    useEffect(() => {
        setGlobalDisplayLimit(200);
    }, [globalTab, globalSub, globalSearch, dateFrom, dateTo]);

    // Global view — same category+sub filtering as customer tab, plus free-text search
    const globalFiltered = useMemo(() => {
        let list = enriched.filter(t => matchesTab(t, globalTab, globalSub));
        if (globalSearch) {
            const q = globalSearch.toLowerCase();
            list = list.filter(t =>
                t.customerName.toLowerCase().includes(q) ||
                (t.customerMobile || '').includes(q) ||
                (t.description || '').toLowerCase().includes(q)
            );
        }
        if (dateFrom) list = list.filter(t => t.date >= dateFrom);
        if (dateTo)   list = list.filter(t => t.date <= dateTo);
        return [...list].sort((a, b) => a.createdAt - b.createdAt);
    }, [enriched, globalTab, globalSub, globalSearch, dateFrom, dateTo]);

    const globalStats = useMemo(() => {
        let cashGot = 0, cashGave = 0;
        let goldGot = 0, goldGave = 0;
        let silverGot = 0, silverGave = 0;
        let metalGot = 0, metalGave = 0;
        globalFiltered.forEach(t => {
            const got  = parseFloat(t.jama  || 0);
            const gave = parseFloat(t.nave  || 0);
            const g    = parseFloat(t.grams || 0);
            if (t.category === 'BULLION' && t.type === 'GOLD') {
                goldGot += got; goldGave += gave;
            } else if ((t.category === 'BULLION' || t.category === 'SILVER') && t.type === 'SILVER') {
                // BULLION·SILVER and SILVER·SILVER both track grams in silverGot/silverGave
                silverGot += got; silverGave += gave;
            } else if (t.sub_type === 'METAL') {
                if (got > 0) metalGot += g; else metalGave += g;
            } else {
                cashGot += got; cashGave += gave;
            }
        });
        return {
            cashGot, cashGave, cashNet: cashGot - cashGave,
            goldGot, goldGave, goldNet: goldGot - goldGave,
            silverGot, silverGave, silverNet: silverGot - silverGave,
            metalGot, metalGave, metalNet: metalGot - metalGave,
        };
    }, [globalFiltered]);

    // Slice for rendering — stats still use full globalFiltered
    const globalVisible = useMemo(
        () => globalFiltered.slice(0, globalDisplayLimit),
        [globalFiltered, globalDisplayLimit]
    );

    const handleDelete = (id) => {
        setPendingDeleteId(id);
        setDeleteInput('');
    };

    const confirmDelete = () => {
        if (deleteInput !== 'DELETE') return;
        deleteTransaction(pendingDeleteId);
        setPendingDeleteId(null);
        setDeleteInput('');
    };

    const handleTabChange = (tab) => { setActiveTab(tab); setActiveSub('ALL'); };

    const selectCustomer = (c) => {
        setCustFilter({ id: c.id, name: c.name });
        setCustSearch('');
        setShowCustDD(false);
    };

    const clearCustFilter = () => { setCustFilter(null); setCustSearch(''); };

    const currentTab = TABS.find(t => t.key === activeTab);

    return (
        <div className="tx-container animate-fade-in" style={{ paddingBottom: '90px' }}>

            {/* Header */}
            <div className="tx-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}>
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 style={{ margin: 0 }}>
                            {viewMode === 'customer' ? 'Ledger' : 'Global Ledger'}
                            {viewMode === 'customer' && custFilter && (
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#22c55e', marginLeft: '0.5rem' }}>
                                    · {custFilter.name}
                                </span>
                            )}
                        </h2>
                        <p style={{ margin: 0 }}>
                            {viewMode === 'customer'
                                ? `${filtered.length} of ${baseTransactions.length} transactions`
                                : `${globalFiltered.length} of ${baseTransactions.length} transactions`}
                            {isRestrictedView && <span style={{ color: '#a5b4fc', marginLeft: '0.4rem', fontSize: '0.75rem' }}>· last 24h</span>}
                        </p>
                    </div>
                </div>

                {viewMode === 'customer' && custFilter ? (
                    <button onClick={handleCustomerExport} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)', borderRadius: '8px', color: '#a5b4fc', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                        <Download size={16} /> Export Statement
                    </button>
                ) : viewMode === 'global' ? (
                    <button onClick={handleGlobalExport} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', color: '#10b981', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                        <Download size={16} /> Export All
                    </button>
                ) : null}
            </div>

            {/* View mode tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                {[{ key: 'customer', label: 'Customer' }, { key: 'global', label: 'Global' }].map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => setViewMode(key)}
                        style={{
                            padding: '0.45rem 1.1rem', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                            background: viewMode === key ? '#6366f1' : 'rgba(255,255,255,0.07)',
                            color: viewMode === key ? '#fff' : 'var(--text-secondary)',
                        }}
                    >{label}</button>
                ))}
                {isOwner && (
                    <button
                        onClick={() => setViewMode('deleted')}
                        style={{
                            padding: '0.45rem 1.1rem', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                            background: viewMode === 'deleted' ? '#ef4444' : 'rgba(255,255,255,0.07)',
                            color: viewMode === 'deleted' ? '#fff' : 'var(--text-secondary)',
                        }}
                    >Recently Deleted</button>
                )}
            </div>

            {/* Staff / View — 24h restriction notice */}
            {isRestrictedView && (
                <div style={{ background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '10px', padding: '0.5rem 0.85rem', marginBottom: '0.75rem', fontSize: '0.78rem', color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>🕐</span>
                    <span>Staff view — showing last 24 hours only · {baseTransactions.length} transactions visible</span>
                </div>
            )}

            {/* ── GLOBAL VIEW ───────────────────────────────────────────── */}
            {viewMode === 'global' && (<>
                {/* Category tabs — identical to customer view */}
                <div className="tx-cat-tabs">
                    {TABS.map(tab => (
                        <button
                            key={tab.key}
                            className={`tx-cat-tab ${globalTab === tab.key ? `tx-cat-active-${tab.key.toLowerCase()}` : ''}`}
                            onClick={() => { setGlobalTab(tab.key); setGlobalSub('ALL'); }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Sub-type pills — identical to customer view */}
                {TABS.find(t => t.key === globalTab)?.subs && (
                    <div className="tx-sub-pills">
                        {TABS.find(t => t.key === globalTab).subs.map(s => (
                            <button
                                key={s}
                                className={`tx-sub-pill ${globalSub === s ? 'tx-sub-active' : ''}`}
                                onClick={() => setGlobalSub(s)}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                )}

                {/* Search */}
                <div className="search-bar" style={{ marginBottom: '0.5rem', marginTop: '0.5rem' }}>
                    <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input type="text" placeholder="Search customer name, mobile, note..." value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} />
                </div>

                {/* Date filter */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'var(--text-primary)', padding: '0.35rem 0.6rem', fontSize: '0.8rem', colorScheme: 'dark', minWidth: 0 }} />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', flexShrink: 0 }}>to</span>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'var(--text-primary)', padding: '0.35rem 0.6rem', fontSize: '0.8rem', colorScheme: 'dark', minWidth: 0 }} />
                    {(dateFrom || dateTo) && (
                        <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', padding: '0.35rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 }}>
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Stats */}
                <div className="tx-stats-bar glass-panel" style={{ marginBottom: '0.75rem', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="tx-stat-label" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Entries</span>
                        <span className="tx-stat-val">{globalFiltered.length}</span>
                    </div>
                    {(globalStats.cashGot > 0 || globalStats.cashGave > 0) && (
                        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', alignItems: 'center', gap: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase' }}>Cash</span>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">You Got</span><span className="tx-stat-val text-green" style={{ fontSize: '0.82rem' }}>₹{fmt(globalStats.cashGot)}</span></div>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">You Gave</span><span className="tx-stat-val text-red" style={{ fontSize: '0.82rem' }}>₹{fmt(globalStats.cashGave)}</span></div>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">Net</span><span className="tx-stat-val" style={{ fontSize: '0.82rem', fontWeight: 700, color: globalStats.cashNet >= 0 ? '#10b981' : '#ef4444' }}>₹{fmt(Math.abs(globalStats.cashNet))} {globalStats.cashNet >= 0 ? 'CR' : 'DR'}</span></div>
                        </div>
                    )}
                    {(globalStats.goldGot > 0 || globalStats.goldGave > 0) && (
                        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', alignItems: 'center', gap: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' }}>Gold</span>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">You Got</span><span className="tx-stat-val text-green" style={{ fontSize: '0.82rem' }}>{fmtG(globalStats.goldGot)}g</span></div>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">You Gave</span><span className="tx-stat-val text-red" style={{ fontSize: '0.82rem' }}>{fmtG(globalStats.goldGave)}g</span></div>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">Net</span><span className="tx-stat-val" style={{ fontSize: '0.82rem', fontWeight: 700, color: globalStats.goldNet >= 0 ? '#f59e0b' : '#ef4444' }}>{fmtG(Math.abs(globalStats.goldNet))}g {globalStats.goldNet >= 0 ? 'CR' : 'DR'}</span></div>
                        </div>
                    )}
                    {(globalStats.silverGot > 0 || globalStats.silverGave > 0) && (
                        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', alignItems: 'center', gap: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Silver</span>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">You Got</span><span className="tx-stat-val text-green" style={{ fontSize: '0.82rem' }}>{fmtG(globalStats.silverGot)}g</span></div>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">You Gave</span><span className="tx-stat-val text-red" style={{ fontSize: '0.82rem' }}>{fmtG(globalStats.silverGave)}g</span></div>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">Net</span><span className="tx-stat-val" style={{ fontSize: '0.82rem', fontWeight: 700, color: globalStats.silverNet >= 0 ? '#94a3b8' : '#ef4444' }}>{fmtG(Math.abs(globalStats.silverNet))}g {globalStats.silverNet >= 0 ? 'CR' : 'DR'}</span></div>
                        </div>
                    )}
                    {(globalStats.metalGot > 0 || globalStats.metalGave > 0) && (
                        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', alignItems: 'center', gap: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase' }}>Metal</span>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">You Got</span><span className="tx-stat-val text-green" style={{ fontSize: '0.82rem' }}>{fmtG(globalStats.metalGot)}g</span></div>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">You Gave</span><span className="tx-stat-val text-red" style={{ fontSize: '0.82rem' }}>{fmtG(globalStats.metalGave)}g</span></div>
                            <div className="tx-stat" style={{ textAlign: 'center' }}><span className="tx-stat-label">Net</span><span className="tx-stat-val" style={{ fontSize: '0.82rem', fontWeight: 700, color: globalStats.metalNet >= 0 ? '#a78bfa' : '#ef4444' }}>{fmtG(Math.abs(globalStats.metalNet))}g {globalStats.metalNet >= 0 ? 'CR' : 'DR'}</span></div>
                        </div>
                    )}
                </div>

                {/* Table */}
                <div className="table-container glass-panel" style={{ padding: 0, overflowX: 'auto' }}>
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Date / Time</th>
                                <th>Type</th>
                                <th>Customer</th>
                                <th>Amount</th>
                                <th>Curr Bal</th>
                                <th>New Bal</th>
                                <th>By</th>
                                {isOwner && <th></th>}
                            </tr>
                        </thead>
                        <tbody>
                            {globalFiltered.length === 0 ? (
                                <tr><td colSpan={isOwner ? 8 : 7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No transactions found.</td></tr>
                            ) : globalVisible.map(t => {
                                const isGot   = t.jama > 0;
                                const isGrams = isGramsType(t);
                                const bFmt    = balFmt(t);
                                return (
                                    <tr key={t.id}>
                                        <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                                            {t.date}<br /><span style={{ fontSize: '0.7rem' }}>{t.time ? t.time.substring(0,5) : ''}</span>
                                        </td>
                                        <td><span className={`tb-badge tb-${(t.category || t.type || '').toLowerCase()}`}>{[t.category, t.sub_type].filter(Boolean).join(' · ') || t.type}</span></td>
                                        <td style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                                            {t.customerName}
                                            {t.description && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{t.description}</div>}
                                            {t.images?.length > 0 && <Camera size={11} style={{ marginLeft: '4px', color: '#60a5fa', verticalAlign: '-1px', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setLightboxImages(t.images); }} />}
                                        </td>
                                        <td style={{ fontWeight: 700, color: isGot ? '#10b981' : '#ef4444', whiteSpace: 'nowrap' }}>
                                            {isGot ? '+' : '−'}{txAmount(t)}
                                        </td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t.currentBalance !== undefined ? bFmt(t.currentBalance) : '—'}</td>
                                        <td style={{ fontWeight: 600, color: (t.newBalance ?? 0) >= 0 ? '#10b981' : '#ef4444', fontSize: '0.85rem' }}>{t.newBalance !== undefined ? bFmt(t.newBalance) : '—'}</td>
                                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.added_by || '—'}</td>
                                        {isOwner && (
                                            <td onClick={e => e.stopPropagation()}>
                                                <button className="btn-delete-icon" onClick={() => handleDelete(t.id)} title="Delete"><Trash2 size={15} /></button>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Load More — only when there are more rows than the display limit */}
                {globalFiltered.length > globalDisplayLimit && (
                    <div style={{ textAlign: 'center', padding: '0.75rem 1rem' }}>
                        <button
                            onClick={() => setGlobalDisplayLimit(l => l + 200)}
                            style={{
                                padding: '0.5rem 1.5rem',
                                background: 'rgba(99,102,241,0.15)',
                                border: '1px solid rgba(99,102,241,0.35)',
                                borderRadius: '8px',
                                color: '#a5b4fc',
                                cursor: 'pointer',
                                fontSize: '0.82rem',
                                fontWeight: 600,
                            }}
                        >
                            Load More · {globalFiltered.length - globalDisplayLimit} remaining
                        </button>
                    </div>
                )}
            </>)}

            {/* ── CUSTOMER VIEW ─────────────────────────────────────────── */}
            {viewMode === 'customer' && (<>

            {/* Category Tabs */}
            <div className="tx-cat-tabs">
                {TABS.map(tab => (
                    <button
                        key={tab.key}
                        className={`tx-cat-tab ${activeTab === tab.key ? `tx-cat-active-${tab.key.toLowerCase()}` : ''}`}
                        onClick={() => handleTabChange(tab.key)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Sub-type pills */}
            {currentTab?.subs && (
                <div className="tx-sub-pills">
                    {currentTab.subs.map(s => (
                        <button
                            key={s}
                            className={`tx-sub-pill ${activeSub === s ? 'tx-sub-active' : ''}`}
                            onClick={() => setActiveSub(s)}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            )}

            {/* Date filter */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'var(--text-primary)', padding: '0.35rem 0.6rem', fontSize: '0.8rem', colorScheme: 'dark', minWidth: 0 }} />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', flexShrink: 0 }}>to</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: 'var(--text-primary)', padding: '0.35rem 0.6rem', fontSize: '0.8rem', colorScheme: 'dark', minWidth: 0 }} />
                {(dateFrom || dateTo) && (
                    <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                        style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#ef4444', padding: '0.35rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 }}>
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* Stats bar */}
            <div className="tx-stats-bar glass-panel" style={{ flexDirection: 'column', gap: '0.5rem' }}>
                {/* Entries row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="tx-stat-label" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Entries</span>
                    <span className="tx-stat-val">{filtered.length}</span>
                </div>

                {/* Cash row */}
                {(tabStats.cashGot > 0 || tabStats.cashGave > 0) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', alignItems: 'center', gap: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase' }}>Cash</span>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">You Got</span>
                            <span className="tx-stat-val text-green" style={{ fontSize: '0.82rem' }}>₹{fmt(tabStats.cashGot)}</span>
                        </div>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">You Gave</span>
                            <span className="tx-stat-val text-red" style={{ fontSize: '0.82rem' }}>₹{fmt(tabStats.cashGave)}</span>
                        </div>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">Net</span>
                            <span className="tx-stat-val" style={{ fontSize: '0.82rem', fontWeight: 700, color: tabStats.cashNet >= 0 ? '#10b981' : '#ef4444' }}>
                                ₹{fmt(Math.abs(tabStats.cashNet))} {tabStats.cashNet >= 0 ? 'CR' : 'DR'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Gold row */}
                {(tabStats.goldGot > 0 || tabStats.goldGave > 0) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', alignItems: 'center', gap: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' }}>Gold</span>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">You Got</span>
                            <span className="tx-stat-val text-green" style={{ fontSize: '0.82rem' }}>{fmtG(tabStats.goldGot)}g</span>
                        </div>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">You Gave</span>
                            <span className="tx-stat-val text-red" style={{ fontSize: '0.82rem' }}>{fmtG(tabStats.goldGave)}g</span>
                        </div>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">Net</span>
                            <span className="tx-stat-val" style={{ fontSize: '0.82rem', fontWeight: 700, color: tabStats.goldNet >= 0 ? '#f59e0b' : '#ef4444' }}>
                                {fmtG(Math.abs(tabStats.goldNet))}g {tabStats.goldNet >= 0 ? 'CR' : 'DR'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Silver row */}
                {(tabStats.silverGot > 0 || tabStats.silverGave > 0) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', alignItems: 'center', gap: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Silver</span>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">You Got</span>
                            <span className="tx-stat-val text-green" style={{ fontSize: '0.82rem' }}>{fmtG(tabStats.silverGot)}g</span>
                        </div>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">You Gave</span>
                            <span className="tx-stat-val text-red" style={{ fontSize: '0.82rem' }}>{fmtG(tabStats.silverGave)}g</span>
                        </div>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">Net</span>
                            <span className="tx-stat-val" style={{ fontSize: '0.82rem', fontWeight: 700, color: tabStats.silverNet >= 0 ? '#94a3b8' : '#ef4444' }}>
                                {fmtG(Math.abs(tabStats.silverNet))}g {tabStats.silverNet >= 0 ? 'CR' : 'DR'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Metal row */}
                {(tabStats.metalGot > 0 || tabStats.metalGave > 0) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr', alignItems: 'center', gap: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.4rem' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase' }}>Metal</span>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">You Got</span>
                            <span className="tx-stat-val text-green" style={{ fontSize: '0.82rem' }}>{fmtG(tabStats.metalGot)}g</span>
                        </div>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">You Gave</span>
                            <span className="tx-stat-val text-red" style={{ fontSize: '0.82rem' }}>{fmtG(tabStats.metalGave)}g</span>
                        </div>
                        <div className="tx-stat" style={{ textAlign: 'center' }}>
                            <span className="tx-stat-label">Net</span>
                            <span className="tx-stat-val" style={{ fontSize: '0.82rem', fontWeight: 700, color: tabStats.metalNet >= 0 ? '#a78bfa' : '#ef4444' }}>
                                {fmtG(Math.abs(tabStats.metalNet))}g {tabStats.metalNet >= 0 ? 'CR' : 'DR'}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Customer filter */}
            <div ref={custRef} style={{ position: 'relative', marginBottom: '0.75rem' }}>
                {custFilter ? (
                    <div className="tx-cust-chip">
                        <User size={13} />
                        <span>{custFilter.name}</span>
                        <button onClick={clearCustFilter} className="tx-cust-chip-x"><X size={12} /></button>
                    </div>
                ) : (
                    <div
                        className={`search-bar tx-cust-search ${showCustDD ? 'focused' : ''}`}
                        style={{ marginBottom: 0 }}
                    >
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
                            <button
                                key={c.id}
                                className="tx-cust-dd-row"
                                onMouseDown={e => { e.preventDefault(); selectCustomer(c); }}
                            >
                                <span className="tx-cust-dd-name">{c.name}</span>
                                <span className="tx-cust-dd-mob">{c.mobile}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Table — only shown when a customer is selected */}
            {!custFilter && (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👤</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Select a customer above to view their transactions</div>
                </div>
            )}
            {custFilter && <div className="table-container glass-panel" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="ui-table">
                    <thead>
                        <tr>
                            <th>Date / Time</th>
                            <th>Category</th>
                            <th>Customer</th>
                            <th>Amount</th>
                            <th>Curr Bal</th>
                            <th>New Bal</th>
                            <th>By</th>
                            {isOwner && <th></th>}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={isOwner ? 8 : 7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                    No transactions found.
                                </td>
                            </tr>
                        ) : filtered.map(t => {
                            const isGot    = t.jama > 0;
                            const isGrams  = isGramsType(t);
                            const bFmt     = balFmt(t);
                            const catLabel = [t.category, t.sub_type].filter(Boolean).join(' · ');
                            const schemeTag = t.chit_scheme ? ` (${t.chit_scheme})` : '';

                            return (
                                <tr key={t.id}>
                                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                                        {t.date}<br />
                                        <span style={{ fontSize: '0.7rem' }}>{t.time ? t.time.substring(0, 5) : ''}</span>
                                    </td>
                                    <td>
                                        <span className={`tb-badge tb-${(t.category || t.type || '').toLowerCase()}`}>
                                            {catLabel || t.type}{schemeTag}
                                        </span>
                                    </td>
                                    <td style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                                        {t.customerName}
                                        {t.description && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{t.description}</div>}
                                        {t.images?.length > 0 && <Camera size={11} style={{ marginLeft: '4px', color: '#60a5fa', verticalAlign: '-1px', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setLightboxImages(t.images); }} />}
                                    </td>
                                    <td style={{ fontWeight: 700, color: isGot ? '#10b981' : '#ef4444', whiteSpace: 'nowrap', fontSize: '0.9rem' }}>
                                        {isGot ? '+' : '−'}{txAmount(t)}
                                        {!isGrams && t.bill_amount > 0 && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>Bill ₹{fmt(t.bill_amount)}</div>}
                                    </td>
                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t.currentBalance !== undefined ? bFmt(t.currentBalance) : '—'}</td>
                                    <td style={{ fontWeight: 600, color: (t.newBalance ?? 0) >= 0 ? '#10b981' : '#ef4444', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{t.newBalance !== undefined ? bFmt(t.newBalance) : '—'}</td>
                                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.added_by || '—'}</td>
                                    {isOwner && (
                                        <td onClick={e => e.stopPropagation()}>
                                            <button className="btn-delete-icon" onClick={() => handleDelete(t.id)} title="Delete"><Trash2 size={15} /></button>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>}

            </>)} {/* end customer view */}

            {/* ── RECENTLY DELETED VIEW (owner only) ───────────────────── */}
            {viewMode === 'deleted' && isOwner && (
                <div className="table-container glass-panel" style={{ padding: 0, overflowX: 'auto', marginTop: '0.5rem' }}>
                    {deletedLoading ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Loading...</div>
                    ) : deletedTxs.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🗑️</div>
                            No deleted transactions found.
                        </div>
                    ) : (
                        <table className="ui-table">
                            <thead>
                                <tr>
                                    <th>Deleted At</th>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Customer</th>
                                    <th>Amount</th>
                                    <th>By</th>
                                </tr>
                            </thead>
                            <tbody>
                                {deletedTxs.map(t => {
                                    const isGot   = t.jama > 0;
                                    const isGrams = t.type === 'GOLD' || t.type === 'SILVER';
                                    const val     = t.jama > 0 ? t.jama : t.nave;
                                    const amtStr  = isGrams ? `${fmtG(val)}g` : `₹${fmt(val)}`;
                                    return (
                                        <tr key={t.id} style={{ opacity: 0.75 }}>
                                            <td style={{ fontSize: '0.75rem', color: '#ef4444', whiteSpace: 'nowrap' }}>
                                                {new Date(t.deleted_at).toLocaleString()}
                                            </td>
                                            <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.date}</td>
                                            <td><span className={`tb-badge tb-${(t.category || '').toLowerCase()}`}>{[t.category, t.sub_type].filter(Boolean).join(' · ')}</span></td>
                                            <td style={{ fontWeight: 600, fontSize: '0.88rem' }}>{t.customerName}</td>
                                            <td style={{ fontWeight: 700, color: isGot ? '#10b981' : '#ef4444', whiteSpace: 'nowrap' }}>
                                                {isGot ? '+' : '−'}{amtStr}
                                            </td>
                                            <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.added_by || '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* ── DELETE CONFIRMATION MODAL ─────────────────────────────── */}
            {pendingDeleteId && (
                <div className="popup-overlay animate-fade-in" style={{ zIndex: 1050, alignItems: 'center' }}>
                    <div className="popup-content" style={{ maxWidth: '380px', borderRadius: '20px', width: '92%' }}>
                        <div className="popup-header">
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#ef4444' }}>Delete Transaction</h3>
                                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>This action will reverse the balance change</p>
                            </div>
                            <button className="cust-back-btn" onClick={() => setPendingDeleteId(null)} style={{ width: 32, height: 32 }}><X size={16} /></button>
                        </div>
                        <div className="popup-body" style={{ padding: '1.25rem 1.5rem' }}>
                            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                                Type <strong style={{ color: '#ef4444' }}>DELETE</strong> to confirm permanent removal.
                            </p>
                            <input
                                className="edit-field-input"
                                type="text"
                                placeholder="Type DELETE to confirm"
                                value={deleteInput}
                                onChange={e => setDeleteInput(e.target.value)}
                                autoFocus
                                style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
                            />
                        </div>
                        <div className="popup-footer">
                            <button className="btn-cancel" onClick={() => setPendingDeleteId(null)}>Cancel</button>
                            <button
                                onClick={confirmDelete}
                                disabled={deleteInput !== 'DELETE'}
                                style={{
                                    padding: '0.6rem 1.25rem', borderRadius: '10px', fontWeight: 600, fontSize: '0.9rem',
                                    background: deleteInput === 'DELETE' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                                    border: `1px solid ${deleteInput === 'DELETE' ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)'}`,
                                    color: deleteInput === 'DELETE' ? '#ef4444' : 'var(--text-muted)',
                                    cursor: deleteInput === 'DELETE' ? 'pointer' : 'not-allowed',
                                    transition: 'all 0.2s',
                                }}
                            >
                                Confirm Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Image Lightbox ─────────────────────────────────────────── */}
            {lightboxImages && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }}
                    onClick={() => setLightboxImages(null)}
                >
                    <button onClick={() => setLightboxImages(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: '50%', width: 36, height: 36, fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                        {lightboxImages.map((img, i) => (
                            <img key={i} src={img.url} alt={`receipt-${i+1}`} style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: '10px', objectFit: 'contain', boxShadow: '0 4px 32px rgba(0,0,0,0.6)' }} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Transactions;
