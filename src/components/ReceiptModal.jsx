import React, { useRef, useState } from 'react';

const fmt = (v) => parseFloat(v || 0).toFixed(2);
const fmtG = (v) => parseFloat(v || 0).toFixed(3);

const ReceiptModal = ({ transaction, customer, onClose }) => {
    const receiptRef = useRef(null);
    const [lightboxImg, setLightboxImg] = useState(null);

    if (!transaction || !customer) return null;

    const isCash = transaction.type === 'CASH';
    const formatAmount = isCash ? fmt : fmtG;
    const unit = isCash ? '₹' : 'g';

    const handleWhatsApp = async () => {
        const isGot = transaction.jama > 0;
        const amt   = isCash
            ? `₹${fmt(isGot ? transaction.jama : transaction.nave)}`
            : `${fmtG(isGot ? transaction.jama : transaction.nave)}g`;
        const cat = [transaction.category, transaction.sub_type].filter(Boolean).join(' · ');

        let msg = `Date: ${transaction.date}${transaction.time ? ` ${transaction.time.substring(0,5)}` : ''}\n`;
        msg += `Amount ${isGot ? 'Received ✅' : 'Given 🔴'}: *${amt}*\n`;
        if (transaction.description) msg += `Note: ${transaction.description}\n`;
        msg += `\n_OneLedger Pro_`;

        // Open WhatsApp directly with customer's number
        const phone = customer.mobile?.replace(/\D/g, '');
        const url = phone
            ? `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`
            : `https://wa.me/?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank');
    };

    const handleShare = async () => {
        if (!navigator.share) return;
        const isGot = transaction.jama > 0;
        const amt   = isCash
            ? `₹${fmt(isGot ? transaction.jama : transaction.nave)}`
            : `${fmtG(isGot ? transaction.jama : transaction.nave)}g`;
        const cat = [transaction.category, transaction.sub_type].filter(Boolean).join(' · ');
        let msg = `Date: ${transaction.date}${transaction.time ? ` ${transaction.time.substring(0,5)}` : ''}\nAmount ${isGot ? 'Received' : 'Given'}: ${amt}\n_OneLedger Pro_`;
        try {
            const shareData = { title: 'OneLedger Pro Receipt', text: msg };
            if (transaction.images?.length > 0) {
                try {
                    const resp = await fetch(transaction.images[0].url);
                    const blob = await resp.blob();
                    const file = new File([blob], 'receipt.jpg', { type: blob.type });
                    if (navigator.canShare?.({ files: [file] })) shareData.files = [file];
                } catch (_) { /* image fetch failed */ }
            }
            await navigator.share(shareData);
        } catch (err) {
            if (err.name !== 'AbortError') console.error('Share failed', err);
        }
    };

    const handlePrint = () => {
        const printContents = receiptRef.current.innerHTML;
        const printWindow = window.open('', '_blank', 'width=400,height=600');
        printWindow.document.write(`
            <html>
            <head>
                <title>Receipt - OneLedger Pro</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 20px; color: #1a1a1a; }
                    .receipt { max-width: 350px; margin: 0 auto; border: 2px solid #1a1a1a; padding: 20px; }
                    .receipt-header { text-align: center; border-bottom: 2px dashed #ccc; padding-bottom: 12px; margin-bottom: 12px; }
                    .receipt-header h2 { font-size: 1.3rem; letter-spacing: 1px; margin-bottom: 2px; }
                    .receipt-header p { font-size: 0.75rem; color: #666; }
                    .receipt-title { text-align: center; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; margin: 10px 0; color: #333; }
                    .receipt-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.85rem; }
                    .receipt-row .label { color: #666; }
                    .receipt-row .value { font-weight: 600; }
                    .receipt-divider { border-top: 1px dashed #ccc; margin: 8px 0; }
                    .receipt-amount { display: flex; justify-content: space-between; padding: 8px 0; font-size: 1rem; font-weight: 700; }
                    .receipt-amount .credit { color: #16a34a; }
                    .receipt-amount .debit { color: #dc2626; }
                    .receipt-footer { text-align: center; border-top: 2px dashed #ccc; padding-top: 12px; margin-top: 12px; font-size: 0.7rem; color: #999; }
                    .receipt-balance { background: #f4f4f5; padding: 8px; border-radius: 4px; margin-top: 8px; }
                    @media print { body { padding: 0; } .receipt { border: none; } }
                </style>
            </head>
            <body>${printContents}<script>window.print(); window.close();</script></body>
            </html>
        `);
        printWindow.document.close();
    };

    return (
        <div
            className="popup-overlay animate-fade-in"
            onClick={onClose}
            style={{ zIndex: 1100 }}
        >
            <div
                className="glass-panel slide-up"
                onClick={e => e.stopPropagation()}
                style={{
                    maxWidth: '420px',
                    width: '90%',
                    maxHeight: '85vh',
                    overflow: 'auto',
                    padding: '1.5rem',
                    borderRadius: '16px'
                }}
            >
                {/* Printable Receipt Content */}
                <div ref={receiptRef}>
                    <div className="receipt" style={{ maxWidth: '350px', margin: '0 auto', border: '2px solid rgba(255,255,255,0.15)', padding: '20px', borderRadius: '12px', background: 'rgba(15,23,42,0.8)' }}>
                        <div style={{ textAlign: 'center', borderBottom: '2px dashed rgba(255,255,255,0.1)', paddingBottom: '12px', marginBottom: '12px' }}>
                            <h2 style={{ fontSize: '1.3rem', letterSpacing: '1px', marginBottom: '2px', color: 'var(--accent-gold, #fbbf24)' }}>OneLedger Pro</h2>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Transaction Receipt</p>
                        </div>

                        <div style={{ textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '2px', margin: '8px 0', color: 'var(--text-secondary)' }}>
                            {transaction.type} Entry
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.85rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Receipt #</span>
                                <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.75rem' }}>{transaction.id?.slice(0, 8).toUpperCase()}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.85rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Date & Time</span>
                                <span style={{ fontWeight: 600 }}>{transaction.date} {transaction.time}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.85rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Customer</span>
                                <span style={{ fontWeight: 600 }}>{customer.name}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.85rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Mobile</span>
                                <span style={{ fontWeight: 600 }}>{customer.mobile}</span>
                            </div>
                        </div>

                        <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '8px 0' }} />

                        {transaction.jama > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '1rem', fontWeight: 700 }}>
                                <span>JAMA (Given)</span>
                                <span style={{ color: '#10b981' }}>{unit}{formatAmount(transaction.jama)}</span>
                            </div>
                        )}
                        {transaction.nave > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '1rem', fontWeight: 700 }}>
                                <span>NAVE (Received)</span>
                                <span style={{ color: '#ef4444' }}>{unit}{formatAmount(transaction.nave)}</span>
                            </div>
                        )}

                        {transaction.description && (
                            <>
                                <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '6px 0' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.85rem' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Note</span>
                                    <span>{transaction.description}</span>
                                </div>
                            </>
                        )}

                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 10px', borderRadius: '6px', marginTop: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '0.82rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Previous Bal</span>
                                <span style={{ fontWeight: 600 }}>
                                    {transaction.currentBalance !== undefined ? `${unit}${formatAmount(transaction.currentBalance)}` : '-'}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '0.9rem', fontWeight: 700 }}>
                                <span>New Balance</span>
                                <span style={{ color: transaction.newBalance >= 0 ? '#10b981' : '#ef4444' }}>
                                    {transaction.newBalance !== undefined ? `${unit}${formatAmount(transaction.newBalance)}` : '-'}
                                </span>
                            </div>
                        </div>

                        {transaction.added_by && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontSize: '0.78rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Added By</span>
                                <span>{transaction.added_by}</span>
                            </div>
                        )}

                        {/* Receipt photos */}
                        {transaction.images?.length > 0 && (
                            <>
                                <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', margin: '8px 0' }} />
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '6px' }}>Receipt Photo{transaction.images.length > 1 ? 's' : ''}</div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    {transaction.images.map((img, i) => (
                                        <img key={i} src={img.url} alt={`receipt-${i+1}`}
                                            onClick={() => setLightboxImg(img.url)}
                                            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)' }} />
                                    ))}
                                </div>
                            </>
                        )}

                        <div style={{ textAlign: 'center', borderTop: '2px dashed rgba(255,255,255,0.1)', paddingTop: '10px', marginTop: '10px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            Thank you for your business<br />
                            OneLedger Pro • OneLedger Pro
                        </div>
                    </div>
                </div>

                {/* Full-screen lightbox */}
                {lightboxImg && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}
                        onClick={() => setLightboxImg(null)}>
                        <button onClick={() => setLightboxImg(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: '50%', width: 36, height: 36, fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
                        <img src={lightboxImg} alt="receipt" style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: '10px', objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
                    </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                        onClick={handleWhatsApp}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.6rem 1.2rem',
                            background: 'rgba(37,211,102,0.15)',
                            border: '1px solid rgba(37,211,102,0.35)',
                            borderRadius: '8px',
                            color: '#25d366',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 600
                        }}
                    >
                        📲 WhatsApp
                    </button>
                    {navigator.share && (
                        <button
                            onClick={handleShare}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                padding: '0.6rem 1rem',
                                background: 'rgba(168,85,247,0.15)',
                                border: '1px solid rgba(168,85,247,0.35)',
                                borderRadius: '8px',
                                color: '#a855f7',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600
                            }}
                        >
                            📤 Share
                        </button>
                    )}
                    <button
                        onClick={handlePrint}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.6rem 1.2rem',
                            background: 'rgba(59,130,246,0.15)',
                            border: '1px solid rgba(59,130,246,0.3)',
                            borderRadius: '8px',
                            color: '#3b82f6',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 600
                        }}
                    >
                        🖨️ Print
                    </button>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '0.6rem 1.2rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 500
                        }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReceiptModal;
