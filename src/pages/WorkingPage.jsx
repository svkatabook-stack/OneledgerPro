import ReceiptImage from '../components/ReceiptImage';
import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { Button } from '../components/ui/Primitives';
import { ArrowLeft, Camera, X } from 'lucide-react';
import './WorkingPage.css';

const fmt  = (v) => parseFloat(v || 0).toFixed(2);
const fmtG = (v) => parseFloat(v || 0).toFixed(2);

const WorkingPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { customers, transactions } = useAppContext();
    const [selectedTx, setSelectedTx] = useState(null);

    const customer = useMemo(() => customers.find(c => c.id === id), [customers, id]);

    const [typeFilter, setTypeFilter] = useState(customer?.primary_category || 'ALL');


    const customerTxs = useMemo(() => {
        let list = transactions.filter(t => t.cid === id);
        if (typeFilter !== 'ALL') {
            list = list.filter(t => t.type === typeFilter);
        }
        list = list.sort((a, b) => a.createdAt - b.createdAt);

        let runBal = 0;
        return list.map(t => {
            runBal += (t.jama - t.nave);
            return { ...t, runningBalance: runBal };
        });
    }, [transactions, id, typeFilter]);

    if (!customer) {
        return (
            <div className="working-container">
                <p>Customer not found.</p>
                <Button onClick={() => navigate('/customers')}>Go Back</Button>
            </div>
        );
    }

    const fmtAmt = (t, val) => t.type === 'CASH' ? fmt(val) : fmtG(val);
    const fmtBal = (t, val) => t.type === 'CASH' ? `₹${fmt(val)}` : `${fmtG(val)}g`;

    return (
        <div className="working-container animate-fade-in" style={{ paddingBottom: '90px' }}>
            {/* Header */}
            <div className="working-header glass-panel">
                <button className="back-btn" onClick={() => navigate('/customers')}>
                    <ArrowLeft size={20} />
                </button>
                <div className="working-customer-info">
                    <h2 className="customer-name">{customer.name}</h2>
                    <span className="customer-mobile">{customer.mobile}</span>
                </div>
            </div>

            {/* Filters */}
            <div className="working-filters">
                {['ALL', 'CASH', 'GOLD', 'SILVER'].map(f => (
                    <button
                        key={f}
                        className={`filter-pill ${typeFilter === f ? 'active' : ''}`}
                        onClick={() => setTypeFilter(f)}
                    >
                        {f}
                    </button>
                ))}
            </div>

            {/* Transactions List */}
            <div className="working-ledger" style={{ marginTop: '1rem' }}>
                <div className="table-container glass-panel" style={{ padding: 0 }}>
                    <table className="ui-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Type</th>
                                <th>JAMA<br /><span style={{ fontSize: '10px', fontWeight: 'normal' }}>(Given)</span></th>
                                <th>NAVE<br /><span style={{ fontSize: '10px', fontWeight: 'normal' }}>(Received)</span></th>
                                <th>Balance</th>
                                <th>📎</th>
                            </tr>
                        </thead>
                        <tbody>
                            {customerTxs.length === 0 ? (
                                <tr>
                                    <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                                        No transactions for {typeFilter}.
                                    </td>
                                </tr>
                            ) : (
                                customerTxs.map(t => (
                                    <tr key={t.id} onClick={() => setSelectedTx(t)} style={{ cursor: 'pointer' }}>
                                        <td style={{ fontSize: '0.8rem' }}>
                                            {t.date}<br />
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t.time ? t.time.substring(0,5) : ''}</span>
                                        </td>
                                        <td><span className={`tb-badge tb-${t.type.toLowerCase()}`}>{t.type}</span></td>
                                        <td className="text-green" style={{ fontWeight: 600 }}>
                                            {t.jama > 0 ? fmtAmt(t, t.jama) : '-'}
                                        </td>
                                        <td className="text-red" style={{ fontWeight: 600 }}>
                                            {t.nave > 0 ? fmtAmt(t, t.nave) : '-'}
                                        </td>
                                        <td className={t.runningBalance >= 0 ? 'text-green' : 'text-red'} style={{ fontWeight: 600 }}>
                                            {t.runningBalance >= 0 ? '+' : ''}{fmtBal(t, t.runningBalance)}
                                        </td>
                                        <td>
                                            {t.images?.length > 0 ? <Camera size={14} className="text-blue" /> : '-'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Transaction Detail — full-screen overlay */}
            {selectedTx && (
                <div
                    style={{
                        position: 'fixed', inset: 0,
                        background: 'rgba(0,0,0,0.65)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 1000,
                        padding: '1rem',
                    }}
                    onClick={() => setSelectedTx(null)}
                >
                    <div
                        className="glass-panel slide-up"
                        onClick={e => e.stopPropagation()}
                        style={{
                            width: '100%', maxWidth: '420px',
                            maxHeight: '80vh', overflowY: 'auto',
                            padding: '1.5rem', borderRadius: '18px',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ margin: 0 }}>Transaction Details</h3>
                            <button onClick={() => setSelectedTx(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
                            {[
                                ['Type',          <span className={`tb-badge tb-${selectedTx.type.toLowerCase()}`}>{selectedTx.type}</span>],
                                ['Date',          `${selectedTx.date} ${selectedTx.time ? selectedTx.time.substring(0,5) : ''}`],
                                ['JAMA (Given)',   selectedTx.jama > 0 ? <span className="text-green" style={{ fontWeight: 600 }}>{fmtAmt(selectedTx, selectedTx.jama)}</span> : '—'],
                                ['NAVE (Received)',selectedTx.nave > 0 ? <span className="text-red"   style={{ fontWeight: 600 }}>{fmtAmt(selectedTx, selectedTx.nave)}</span>   : '—'],
                                ['Running Balance',<span className={selectedTx.runningBalance >= 0 ? 'text-green' : 'text-red'} style={{ fontWeight: 600 }}>{fmtBal(selectedTx, selectedTx.runningBalance)}</span>],
                                ...(selectedTx.description ? [['Note', selectedTx.description]] : []),
                                ...(selectedTx.added_by    ? [['Added By', selectedTx.added_by]] : []),
                            ].map(([label, value]) => (
                                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                                    <span>{value}</span>
                                </div>
                            ))}
                        </div>

                        {selectedTx.images?.length > 0 && (
                            <div style={{ marginTop: '1rem' }}>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Receipt Photos</p>
                                {selectedTx.images.map((img, i) => (
                                    <div key={i}>
                                        <ReceiptImage image={img} alt={`Receipt ${i + 1}`} style={{ width: '100%', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkingPage;
