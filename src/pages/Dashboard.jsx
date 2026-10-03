import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import './Dashboard.css';

const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtG = (v) => parseFloat(v || 0).toFixed(3);
const n    = (v) => parseFloat(v || 0);

// Balance keys that are grams-based (not cash ₹)
const GRAMS_BAL_KEYS = new Set(['retailGold', 'bullionGold', 'bullionSilver', 'silverSilver']);

// ── Key account definitions per KPI section ───────────────────────────────────
// source:'bal' → read directly from customer[balKey]
// source:'tx'  → aggregate jama−nave from transactions filtered by category+subType
//                (used for RETAIL·METAL because getTxType returns 'CASH' for it,
//                 so the grams net must come from transactions, not a balance field)
// Configure OneLedger key accounts after business-specific setup.
const KEY_ACCOUNTS = { retail: [], bullion: [], silver: [] };

/* ── Live Ticker ──────────────────────────────────────────────────────────── */
const Ticker = ({ totalCash, totalGold, totalSilver }) => {
    const cashColor = totalCash >= 0 ? '#22c55e' : '#f43f5e';
    const cashSign  = totalCash >= 0 ? '+' : '-';

    const items = [
        { icon: '💵', label: 'Cash',         value: `${cashSign}₹${fmt(Math.abs(totalCash))}`, color: cashColor },
        { icon: '🥇', label: 'Gold',         value: `${fmtG(totalGold)}g`,                     color: '#fbbf24' },
        { icon: '🥈', label: 'Silver',       value: `${fmtG(totalSilver)}g`,                   color: '#94a3b8' },
        { icon: '📊', label: 'OneLedger Pro', value: '',                                        color: '#6366f1' },
    ];
    const allItems = [...items, ...items, ...items];

    return (
        <div className="ticker-bar">
            <div className="ticker-label">LIVE</div>
            <div className="ticker-viewport">
                <div className="ticker-track">
                    {allItems.map((item, i) => (
                        <span key={i} className="ticker-item">
                            <span className="ticker-icon">{item.icon}</span>
                            <span className="ticker-name">{item.label}</span>
                            {item.value && <span className="ticker-value" style={{ color: item.color }}>{item.value}</span>}
                            <span className="ticker-sep">·</span>
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
};

/* ── Aggregate subtype row (Net only) ─────────────────────────────────────── */
const SubTypeRow = ({ label, got, gave, isGrams, metalColor }) => {
    const hasGot  = Math.abs(n(got))  > 0.0001;
    const hasGave = Math.abs(n(gave)) > 0.0001;
    if (!hasGot && !hasGave) return null;

    const net    = n(got) + n(gave);
    const netPos = net >= 0;
    const fmtNet = isGrams
        ? `${net >= 0 ? '+' : '-'}${fmtG(Math.abs(net))}g`
        : `${net >= 0 ? '+' : '-'}₹${fmt(Math.abs(net))}`;

    return (
        <div className="kpi-subtype-block">
            <div className="kpi-subtype-label" style={{ color: metalColor || 'var(--text-muted)' }}>{label}</div>
            <div className="kpi-subtype-rows">
                <div className="kpi-sub kpi-net-row">
                    <span className="kpi-sub-label">Net</span>
                    <span style={{ color: netPos ? '#22c55e' : '#f43f5e', fontWeight: 800, fontSize: '0.82rem' }}>
                        {fmtNet}{!isGrams && (netPos ? ' CR' : ' DR')}
                    </span>
                </div>
            </div>
        </div>
    );
};

/* ── Individual key-account net row ──────────────────────────────────────── */
const KeyAccountRow = ({ name, label, val, isGrams }) => {
    const isPos  = val >= 0;
    const fmtVal = isGrams
        ? `${fmtG(Math.abs(val))}g`
        : `₹${fmt(Math.abs(val))}`;
    return (
        <div className="kpi-sub" style={{ paddingTop: '3px', paddingBottom: '3px' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginLeft: '4px' }}>· {label}</span>
            </span>
            <span style={{ color: isPos ? '#22c55e' : '#f43f5e', fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                {isPos ? '+' : '-'}{fmtVal} {isPos ? 'CR' : 'DR'}
            </span>
        </div>
    );
};

/* ── KPI Card ─────────────────────────────────────────────────────────────── */
const KPICard = ({ cls, title, emoji, subtypes, accounts }) => (
    <div className={`kpi-card ${cls}`}>
        <div className="kpi-header">
            <h3>{emoji} {title}</h3>
        </div>
        <div className="kpi-body">
            {subtypes.map((s, i) => (
                <SubTypeRow key={i} label={s.label} got={s.slot.got} gave={s.slot.gave} isGrams={s.isGrams} metalColor={s.metalColor} />
            ))}
            {accounts?.length > 0 && (
                <>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '6px 0 3px', fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                        Key Accounts
                    </div>
                    {accounts.map((a, i) => <KeyAccountRow key={i} {...a} />)}
                </>
            )}
        </div>
    </div>
);

/* ── Dashboard ────────────────────────────────────────────────────────────── */
const Dashboard = () => {
    const navigate = useNavigate();
    const { customers, transactions, authSession } = useAppContext();

    // Staff / View roles see only last-24h transactions (owner / super-admin see all)
    const isRestrictedView = authSession?.role === 'staff' || authSession?.role === 'view';
    const txFor24h = useMemo(() => {
        if (!isRestrictedView) return transactions;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        return transactions.filter(t => t.createdAt && t.createdAt >= cutoff);
    }, [transactions, isRestrictedView]);

    // Aggregate stats per category
    const stats = useMemo(() => {
        const mk = () => ({ got: 0, gave: 0 });
        const t = {
            retail:  { cash: mk(), gold: mk() },
            bullion: { cash: mk(), gold: mk(), silver: mk() },
            silver:  { cash: mk(), silver: mk() },
            chit:    { cash: mk() },
        };
        const acc = (slot, val) => {
            const v = n(val || 0);
            if (v > 0) slot.got  += v;
            else       slot.gave += v;
        };
        customers.forEach(c => {
            acc(t.retail.cash,    c.retailCash);
            acc(t.retail.gold,    c.retailGold);
            acc(t.bullion.cash,   c.bullionCash);
            acc(t.bullion.gold,   c.bullionGold);
            acc(t.bullion.silver, c.bullionSilver);
            acc(t.silver.cash,    c.silverCash);
            acc(t.silver.silver,  c.silverSilver);
            acc(t.chit.cash,      c.chitCash);
        });
        return t;
    }, [customers]);

    // Ticker totals
    const totals = useMemo(() => {
        let cash = 0, gold = 0, silver = 0;
        customers.forEach(c => {
            cash   += n(c.retailCash) + n(c.bullionCash) + n(c.silverCash) + n(c.chitCash);
            gold   += n(c.retailGold) + n(c.bullionGold);
            silver += n(c.bullionSilver) + n(c.silverSilver);
        });
        return { cash, gold, silver };
    }, [customers]);

    // Pre-built name → customer map — O(n) once, O(1) lookups below
    const custNameMap = useMemo(() => {
        const map = {};
        customers.forEach(c => { map[c.name] = c; });
        return map;
    }, [customers]);

    // Pre-built tx sum map: `${cid}|${category}|${subType}` → net (jama − nave)
    // nave is stored as a positive number, so net = jama - nave (not jama + nave).
    // Uses txFor24h so staff/view roles see only the last-24h activity.
    const txSumMap = useMemo(() => {
        const map = {};
        txFor24h.forEach(t => {
            if (t.deleted_at) return;
            const key = `${t.cid}|${t.category}|${t.sub_type}`;
            map[key] = (map[key] || 0) + n(t.jama) - n(t.nave);
        });
        return map;
    }, [txFor24h]);

    // Key account rows — O(1) lookups instead of O(n) find + O(m) filter/reduce per entry
    const keyAccountRows = useMemo(() => {
        const resolve = (section) =>
            KEY_ACCOUNTS[section]
                .map((entry) => {
                    const { name, source, label, isGrams } = entry;
                    const cust = custNameMap[name];
                    if (!cust) return null;

                    if (source === 'bal') {
                        const val = n(cust[entry.balKey]);
                        if (Math.abs(val) < 0.0001) return null;
                        return { name, label, val, isGrams: GRAMS_BAL_KEYS.has(entry.balKey) };
                    } else {
                        // O(1) map lookup instead of O(m) filter+reduce
                        const val = txSumMap[`${cust.id}|${entry.category}|${entry.subType}`] || 0;
                        if (Math.abs(val) < 0.0001) return null;
                        return { name, label, val, isGrams };
                    }
                })
                .filter(Boolean);
        return {
            retail:  resolve('retail'),
            bullion: resolve('bullion'),
            silver:  resolve('silver'),
        };
    }, [custNameMap, txSumMap]);

    return (
        <div className="dashboard-page">
            <Ticker totalCash={totals.cash} totalGold={totals.gold} totalSilver={totals.silver} />

            <div className="dashboard-container animate-fade-in" style={{ paddingBottom: '90px' }}>

                {/* Staff / View — 24h restriction notice */}
                {isRestrictedView && (
                    <div style={{ background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: '10px', padding: '0.5rem 0.85rem', marginBottom: '0.75rem', fontSize: '0.78rem', color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>🕐</span>
                        <span>Staff view — key account activity reflects last 24 hours only ({txFor24h.length} transactions)</span>
                    </div>
                )}

                <div className="dash-header">
                    <div>
                        <h2 className="dash-title">Financial Position</h2>
                        <p className="dash-subtitle">{customers.length} customers · all categories</p>
                    </div>
                </div>

                {/* Per-category KPI cards */}
                <div className="kpi-grid">
                    <KPICard
                        cls="kpi-retail"
                        title="Retail"
                        emoji="🏪"
                        subtypes={[
                            { label: 'Cash', slot: stats.retail.cash, isGrams: false },
                            { label: 'Gold', slot: stats.retail.gold, isGrams: true, metalColor: '#fbbf24' },
                        ]}
                        accounts={keyAccountRows.retail}
                    />
                    <KPICard
                        cls="kpi-bullion"
                        title="Bullion"
                        emoji="🥇"
                        subtypes={[
                            { label: 'Cash',   slot: stats.bullion.cash,   isGrams: false },
                            { label: 'Gold',   slot: stats.bullion.gold,   isGrams: true, metalColor: '#fbbf24' },
                            { label: 'Silver', slot: stats.bullion.silver, isGrams: true, metalColor: '#94a3b8' },
                        ]}
                        accounts={keyAccountRows.bullion}
                    />
                    <KPICard
                        cls="kpi-silver"
                        title="Silver"
                        emoji="🥈"
                        subtypes={[
                            { label: 'Cash',   slot: stats.silver.cash,   isGrams: false },
                            { label: 'Silver', slot: stats.silver.silver, isGrams: true, metalColor: '#94a3b8' },
                        ]}
                        accounts={keyAccountRows.silver}
                    />
                    <KPICard
                        cls="kpi-chit"
                        title="Chit"
                        emoji="📋"
                        subtypes={[
                            { label: 'Cash', slot: stats.chit.cash, isGrams: false },
                        ]}
                    />
                </div>

                {/* Quick-nav cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    {[
                        { label: 'Customers',    sub: `${customers.length} registered`,  path: '/customers',    color: '#6366f1' },
                        { label: 'Transactions', sub: 'Add a new entry',                  path: '/transactions', color: '#f59e0b' },
                        { label: 'Ledger',       sub: 'View all transactions',            path: '/ledger',       color: '#10b981' },
                        { label: 'Dues',         sub: 'Pending collections',              path: '/due',          color: '#ef4444' },
                    ].map(({ label, sub, path, color }) => (
                        <div key={path} onClick={() => navigate(path)} className="glass-panel"
                            style={{ padding: '1rem', borderRadius: '14px', cursor: 'pointer', borderLeft: `3px solid ${color}`, transition: 'transform 0.15s' }}>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color }}>{label}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '3px' }}>{sub}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
