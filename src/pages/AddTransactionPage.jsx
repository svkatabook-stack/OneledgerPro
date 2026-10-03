import React, { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowLeft, CheckCircle2, ChevronRight, Camera, X } from 'lucide-react';
import { useAppContext, getCatBalKey } from '../context/AppContext';
import { compressImage, uploadToCloudinary } from '../utils/imageUtils';
import ReceiptModal from '../components/ReceiptModal';
import '../components/TransactionPopup.css';
import './AddTransactionPage.css';

/* ── Config ──────────────────────────────────────────────────────────────── */
const CATEGORIES = [
    {
        key: 'RETAIL', label: 'Retail', emoji: '🏪',
        desc: 'Cash & metal transactions',
        color: '#6366f1', dim: 'rgba(99,102,241,0.15)', glow: 'rgba(99,102,241,0.35)',
    },
    {
        key: 'BULLION', label: 'Bullion', emoji: '🥇',
        desc: 'Gold & silver bullion trading',
        color: '#f59e0b', dim: 'rgba(245,158,11,0.15)', glow: 'rgba(245,158,11,0.35)',
    },
    {
        key: 'SILVER', label: 'Silver', emoji: '🥈',
        desc: 'Cash & silver transactions',
        color: '#94a3b8', dim: 'rgba(148,163,184,0.15)', glow: 'rgba(148,163,184,0.35)',
    },
    {
        key: 'CHIT', label: 'Chit', emoji: '📋',
        desc: 'Chit fund & scheme installments',
        color: '#10b981', dim: 'rgba(16,185,129,0.15)', glow: 'rgba(16,185,129,0.35)',
    },
];

// sub_type → display label, balance type, input unit
const SUBTYPES = {
    RETAIL: [
        { key: 'CASH',  label: 'Cash',  type: 'CASH',   unit: '₹',   isGrams: false },
        { key: 'METAL', label: 'Metal', type: 'GOLD',   unit: 'g',   isGrams: true, hasBill: true },
    ],
    BULLION: [
        { key: 'CASH',   label: 'Cash',   type: 'CASH',   unit: '₹', isGrams: false },
        { key: 'GOLD',   label: 'Gold',   type: 'GOLD',   unit: 'g', isGrams: true },
        { key: 'SILVER', label: 'Silver', type: 'SILVER', unit: 'g', isGrams: true },
    ],
    SILVER: [
        { key: 'CASH',   label: 'Cash',   type: 'CASH',   unit: '₹', isGrams: false },
        { key: 'SILVER', label: 'Silver', type: 'SILVER', unit: 'g', isGrams: true },
    ],
    CHIT: [
        { key: 'CASH', label: 'Cash', type: 'CASH', unit: '₹', isGrams: false },
    ],
};

const fmt  = (v) => parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtG = (v) => parseFloat(v || 0).toFixed(3);
const n    = (v) => parseFloat(v || 0);

/* ── Helper: category-isolated balance ────────────────────────────────────── */
const getBalance = (customer, category, type) => {
    if (!customer) return 0;
    const catKey = getCatBalKey(category, type);
    if (catKey !== null && customer[catKey] !== undefined) return n(customer[catKey]);
    // Fallback to aggregate for legacy data
    if (type === 'CASH')   return n(customer.cashBalance);
    if (type === 'GOLD')   return n(customer.goldBalance);
    if (type === 'SILVER') return n(customer.silverBalance);
    return 0;
};

const fmtBal = (val, isGrams) =>
    isGrams ? `${fmtG(val)}g` : `₹${fmt(val)}`;

/* ─────────────────────────────────────────────────────────────────────────── */

const AddTransactionPage = () => {
    const { customers, transactions, chitSchemes, addTransaction, authSession } = useAppContext();
    const navigate = useNavigate();

    const [step,     setStep]     = useState(1);   // 1 | 2 | 3
    const [category, setCategory] = useState(null);
    const [customer, setCustomer] = useState(null);

    // Step 2
    const [searchQ, setSearchQ] = useState('');

    // Step 3 form
    const [op,          setOp]          = useState('got');
    const [subType,     setSubType]     = useState('CASH');
    const [scheme,      setScheme]      = useState('');
    const [amount,      setAmount]      = useState('');
    const [billAmount,  setBillAmount]  = useState('');
    const [date,        setDate]        = useState(new Date().toISOString().split('T')[0]);
    const [dueDate,     setDueDate]     = useState('');
    const [description, setDescription] = useState('');
    const [images,      setImages]      = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [saved,       setSaved]       = useState(false);
    const [saving,      setSaving]      = useState(false);
    const [receipt,     setReceipt]     = useState(null);
    const fileInputRef = useRef(null);

    /* ── Derived ── */
    const catCfg   = CATEGORIES.find(c => c.key === category);
    const subtypes = category ? SUBTYPES[category] : [];
    const subCfg   = subtypes.find(s => s.key === subType) || subtypes[0];
    const isChit   = category === 'CHIT';

    const prevBalance = useMemo(() => getBalance(customer, category, subCfg?.type), [customer, category, subCfg]);
    const delta       = useMemo(() => {
        const val = n(amount);
        return op === 'got' ? val : -val;
    }, [amount, op]);
    const newBalance  = prevBalance + delta;

    /* ── Filtered customers ── */
    const filteredCusts = useMemo(() => {
        const q = searchQ.toLowerCase();
        if (!q) return customers;
        return customers.filter(c =>
            c.name.toLowerCase().includes(q) || (c.mobile || '').includes(q)
        );
    }, [customers, searchQ]);

    /* ── Last 5 transactions for selected customer ── */
    const lastFiveTxs = useMemo(() => {
        if (!customer) return [];
        return [...transactions]
            .filter(t => t.cid === customer.id && !t.deleted_at)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, 5);
    }, [transactions, customer]);

    /* ── Navigation helpers ── */
    const goCategory = (cat) => {
        setCategory(cat);
        setSubType(SUBTYPES[cat][0].key);
        setStep(2);
    };

    const goCustomer = (c) => {
        setCustomer(c);
        setStep(3);
        setSearchQ('');
    };

    const handleBack = () => {
        if (step === 3) { setCustomer(null); resetForm(); setStep(2); }
        else if (step === 2) { setCategory(null); setStep(1); }
        else navigate('/');
    };

    const resetForm = () => {
        setOp('got'); setAmount(''); setBillAmount('');
        setDescription(''); setSaved(false); setSaving(false);
        setScheme(''); setImages([]); setDueDate('');
    };

    const handleImagePick = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const compressed = await compressImage(file);
            const uploaded   = await uploadToCloudinary(compressed);
            setImages(prev => [...prev, uploaded]);
        } catch (err) {
            alert('Image upload failed: ' + err.message);
        } finally {
            setIsUploading(false);
            e.target.value = '';
        }
    };

    /* ── Save ── */
    const canSave = n(amount) > 0 && (!isChit || scheme);

    const handleSave = () => {
        if (!canSave) return;
        setSaving(true);

        const val  = n(amount);
        const jama = op === 'got'  ? val : 0;
        const nave = op === 'gave' ? val : 0;
        const now  = new Date();
        const txTime = now.toTimeString().split(' ')[0];

        const txData = {
            customerId:  customer.id,
            type:        subCfg.type,
            category,
            sub_type:    subType,
            jama,
            nave,
            grams:       subCfg.isGrams ? val : 0,
            bill_amount: n(billAmount),
            date,
            time:        txTime,
            description,
            chit_scheme: isChit ? scheme : '',
            added_by:    authSession?.role || 'Staff',
            images,
            due_date:    dueDate || null,
        };

        addTransaction(txData);

        // Show receipt
        setReceipt({
            ...txData,
            id:              `${now.getTime()}`,
            currentBalance:  prevBalance,
            newBalance:      newBalance,
            isGrams:         subCfg.isGrams,
            categoryLabel:   catCfg?.label,
            subTypeLabel:    subCfg?.label,
        });

        setSaved(true);
        resetForm();
        setSaved(false);
    };

    /* ── Receipt close ── */
    const handleReceiptClose = () => setReceipt(null);

    /* ── Step 1: Category ── */
    if (step === 1) return (
        <div className="atp-page animate-fade-in">
            <div className="atp-top-bar">
                <button className="atp-back-btn" onClick={() => navigate('/')}>
                    <ArrowLeft size={18} />
                </button>
                <div>
                    <h2 className="atp-page-title">Add Transaction</h2>
                    <p className="atp-page-sub">Select a category to begin</p>
                </div>
            </div>

            <div className="atp-cat-grid">
                {CATEGORIES.map(cat => (
                    <button
                        key={cat.key}
                        className="atp-cat-card"
                        style={{ '--cat-c': cat.color, '--cat-dim': cat.dim, '--cat-glow': cat.glow }}
                        onClick={() => goCategory(cat.key)}
                    >
                        <span className="atp-cat-emoji">{cat.emoji}</span>
                        <span className="atp-cat-name">{cat.label}</span>
                        <span className="atp-cat-desc">{cat.desc}</span>
                        <ChevronRight size={16} className="atp-cat-arrow" />
                    </button>
                ))}
            </div>
        </div>
    );

    /* ── Step 2: Customer ── */
    if (step === 2) return (
        <div className="atp-page animate-fade-in">
            <div className="atp-top-bar">
                <button className="atp-back-btn" onClick={handleBack}>
                    <ArrowLeft size={18} />
                </button>
                <div>
                    <h2 className="atp-page-title" style={{ color: catCfg?.color }}>
                        {catCfg?.emoji} {catCfg?.label}
                    </h2>
                    <p className="atp-page-sub">Select customer</p>
                </div>
            </div>

            <div className="search-bar" style={{ marginBottom: '1rem' }}>
                <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                    type="text"
                    placeholder="Search by name or mobile..."
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                    autoFocus
                />
            </div>

            <div className="atp-cust-list">
                {filteredCusts.length === 0 ? (
                    <div className="atp-empty">No customers found.</div>
                ) : filteredCusts.map(c => (
                    <button key={c.id} className="atp-cust-row" onClick={() => goCustomer(c)}>
                        <div className="atp-cust-info">
                            <span className="atp-cust-name">{c.name}</span>
                            <span className="atp-cust-mobile">{c.mobile}</span>
                        </div>
                        <div className="atp-cust-bals">
                            {n(c.cashBalance) !== 0 && (
                                <span className={`atp-bal-chip ${n(c.cashBalance) >= 0 ? 'green' : 'red'}`}>
                                    ₹{fmt(c.cashBalance)}
                                </span>
                            )}
                            {n(c.goldBalance) !== 0 && (
                                <span className="atp-bal-chip gold">
                                    {fmtG(c.goldBalance)}g Gold
                                </span>
                            )}
                            {n(c.silverBalance) !== 0 && (
                                <span className="atp-bal-chip silver">
                                    {fmtG(c.silverBalance)}g Silver
                                </span>
                            )}
                        </div>
                        <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    </button>
                ))}
            </div>
        </div>
    );

    /* ── Step 3: Form ── */
    return (
    <>
        <div className="atp-page animate-fade-in">
            {/* Header */}
            <div className="atp-top-bar">
                <button className="atp-back-btn" onClick={handleBack}>
                    <ArrowLeft size={18} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 className="atp-page-title" style={{ color: catCfg?.color }}>
                        {catCfg?.emoji} {catCfg?.label}
                    </h2>
                    <p className="atp-page-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {customer.name} · {customer.mobile}
                    </p>
                </div>
            </div>

            <div className="atp-form-card">

                {/* ── Last 5 transactions for this customer ── */}
                {lastFiveTxs.length > 0 && (
                    <div style={{
                        background: 'rgba(255,255,255,0.04)',
                        borderRadius: '10px',
                        border: '1px solid rgba(255,255,255,0.08)',
                        padding: '0.55rem 0.75rem',
                        marginBottom: '0.85rem',
                    }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
                            Last {lastFiveTxs.length} Transaction{lastFiveTxs.length > 1 ? 's' : ''}
                        </div>
                        {lastFiveTxs.map((t, i) => {
                            const isGot   = t.jama > 0;
                            const amt     = isGot ? t.jama : t.nave;
                            const isGrams = t.type === 'GOLD' || t.type === 'SILVER';
                            const amtStr  = isGrams ? `${fmtG(amt)}g` : `₹${fmt(amt)}`;
                            const catTag  = [t.category, t.sub_type].filter(Boolean).join('·');
                            return (
                                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.22rem 0', borderBottom: i < lastFiveTxs.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', minWidth: '68px', flexShrink: 0 }}>{t.date}</span>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {catTag}{t.description ? ` — ${t.description}` : ''}
                                    </span>
                                    <span style={{ fontSize: '0.76rem', fontWeight: 700, color: isGot ? '#10b981' : '#ef4444', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                        {isGot ? '+' : '−'}{amtStr}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* You Got / You Gave */}
                <div className="atp-op-tabs">
                    <button
                        className={`atp-op-tab ${op === 'got' ? 'atp-op-got' : ''}`}
                        onClick={() => setOp('got')}
                    >
                        <span className="atp-op-main">YOU GOT</span>
                        <span className="atp-op-sub">Customer paid you</span>
                    </button>
                    <button
                        className={`atp-op-tab ${op === 'gave' ? 'atp-op-gave' : ''}`}
                        onClick={() => setOp('gave')}
                    >
                        <span className="atp-op-main">YOU GAVE</span>
                        <span className="atp-op-sub">You paid customer</span>
                    </button>
                </div>

                {/* Sub-type pills */}
                {subtypes.length > 1 && (
                    <div className="atp-form-section">
                        <label className="atp-label">Type</label>
                        <div className="atp-sub-pills">
                            {subtypes.map(s => (
                                <button
                                    key={s.key}
                                    className={`atp-sub-pill ${subType === s.key ? 'atp-sub-active' : ''}`}
                                    style={subType === s.key ? { '--cat-c': catCfg?.color, '--cat-dim': catCfg?.dim } : {}}
                                    onClick={() => { setSubType(s.key); setAmount(''); setBillAmount(''); }}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Chit scheme */}
                {isChit && (
                    <div className="atp-form-section">
                        <label className="atp-label">Scheme</label>
                        <div className="atp-scheme-pills">
                            {chitSchemes.map(s => (
                                <button
                                    key={s}
                                    className={`atp-scheme-pill ${scheme === s ? 'atp-scheme-active' : ''}`}
                                    onClick={() => setScheme(s)}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Amount input */}
                <div className="atp-form-section">
                    <label className="atp-label">
                        {subCfg?.isGrams ? 'Weight (grams)' : 'Amount (₹)'}
                    </label>
                    <div className="atp-input-wrap">
                        {!subCfg?.isGrams && (
                            <span className="atp-unit-badge atp-badge-rs">₹</span>
                        )}
                        <input
                            type="number"
                            inputMode="decimal"
                            placeholder={subCfg?.isGrams ? '0.000' : '0.00'}
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            className="atp-amount-input"
                        />
                        {subCfg?.isGrams && (
                            <span className="atp-unit-badge atp-badge-g">g</span>
                        )}
                    </div>
                </div>

                {/* Bill amount — only for RETAIL METAL */}
                {subCfg?.hasBill && (
                    <div className="atp-form-section">
                        <label className="atp-label">Bill Amount (₹) <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></label>
                        <div className="atp-input-wrap">
                            <span className="atp-unit-badge atp-badge-rs">₹</span>
                            <input
                                type="number"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={billAmount}
                                onChange={e => setBillAmount(e.target.value)}
                                className="atp-amount-input"
                            />
                        </div>
                    </div>
                )}

                {/* Balance bar */}
                {subCfg && n(amount) > 0 && (
                    <div className="atp-balance-bar">
                        <div className="atp-bal-col">
                            <span className="atp-bal-label">Current</span>
                            <span className="atp-bal-val">{fmtBal(prevBalance, subCfg.isGrams)}</span>
                        </div>
                        <div className="atp-bal-arrow">
                            <span className={`atp-delta-chip ${delta >= 0 ? 'up' : 'down'}`}>
                                {delta >= 0 ? '+' : ''}{fmtBal(delta, subCfg.isGrams)}
                            </span>
                        </div>
                        <div className="atp-bal-col atp-bal-right">
                            <span className="atp-bal-label">New Balance</span>
                            <span className={`atp-new-bal ${newBalance >= 0 ? 'green' : 'red'}`}>
                                {fmtBal(newBalance, subCfg.isGrams)}
                            </span>
                        </div>
                    </div>
                )}

                {/* Date */}
                <div className="atp-form-section">
                    <label className="atp-label">Date</label>
                    <input
                        type="date"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="atp-date-input"
                    />
                </div>

                {/* Due Date */}
                <div className="atp-form-section">
                    <label className="atp-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Due Date <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></span>
                        {dueDate && (
                            <button onClick={() => setDueDate('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: 0 }}>
                                Clear
                            </button>
                        )}
                    </label>
                    <input
                        type="date"
                        value={dueDate}
                        min={new Date().toISOString().split('T')[0]}
                        onChange={e => setDueDate(e.target.value)}
                        className="atp-date-input"
                        style={{ borderColor: dueDate ? 'rgba(245,158,11,0.5)' : undefined }}
                    />
                    {dueDate && (
                        <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '0.3rem' }}>
                            Next due: {new Date(dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </div>
                    )}
                </div>

                {/* Note */}
                <div className="atp-form-section">
                    <label className="atp-label">Note <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></label>
                    <textarea
                        placeholder="Add a note..."
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        className="atp-text-input"
                        rows={2}
                        style={{ resize: 'none', lineHeight: '1.5' }}
                    />
                </div>

                {/* Photos */}
                <div className="atp-form-section">
                    <label className="atp-label">Photos <span style={{ fontWeight: 400, textTransform: 'none' }}>optional</span></label>
                    <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        ref={fileInputRef}
                        onChange={handleImagePick}
                        style={{ display: 'none' }}
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current.click()}
                        disabled={isUploading}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.55rem 1rem', borderRadius: '10px', cursor: 'pointer',
                            background: 'rgba(255,255,255,0.06)', border: '1px dashed rgba(255,255,255,0.2)',
                            color: 'var(--text-secondary)', fontSize: '0.85rem', width: '100%', justifyContent: 'center',
                        }}
                    >
                        <Camera size={16} />
                        {isUploading ? 'Uploading...' : 'Add Photo'}
                    </button>
                    {images.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                            {images.map((img, i) => (
                                <div key={i} style={{ position: 'relative', width: '72px', height: '72px' }}>
                                    <img src={img.url} alt="receipt" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)' }} />
                                    <button
                                        onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                                        style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#ef4444', border: 'none', borderRadius: '50%', width: '20px', height: '20px', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                                    >
                                        <X size={11} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Save button */}
                <button
                    className={`atp-save-btn ${saved ? 'atp-saved' : ''}`}
                    onClick={handleSave}
                    disabled={!canSave || saving}
                    style={{ '--cat-c': catCfg?.color, '--cat-glow': catCfg?.glow }}
                >
                    {saved ? (
                        <><CheckCircle2 size={18} /> Saved!</>
                    ) : (
                        `Save Transaction`
                    )}
                </button>

            </div>
        </div>

        {receipt && (
            <ReceiptModal
                transaction={receipt}
                customer={customer}
                onClose={handleReceiptClose}
            />
        )}
    </>
    );
};

export default AddTransactionPage;
