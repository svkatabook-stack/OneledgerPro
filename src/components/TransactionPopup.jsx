import React, { useState, useEffect, useRef } from 'react';
import { Camera, XCircle, Search, Check, CalendarDays, Phone, X } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import ReceiptModal from './ReceiptModal';
import { compressImage, uploadToCloudinary } from '../utils/imageUtils';
import './TransactionPopup.css';

const TransactionPopup = ({ presetCustomerId = null, onClose }) => {
    const { customers, transactions, addTransaction } = useAppContext();

    const [step, setStep] = useState(presetCustomerId ? 2 : 1);
    const [searchQ, setSearchQ] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState(
        presetCustomerId ? customers.find(c => c.id === presetCustomerId) : null
    );

    const todayStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toTimeString().substring(0, 5);

    const [form, setForm] = useState({
        type: selectedCustomer?.primary_category || 'CASH',
        jama: '',
        nave: '',
        desc: '',
        date: todayStr,
        time: timeStr,
        dueDateToggle: false,
        dueDate: '',
        whatsapp: false,
        addedBy: 'Owner'
    });

    const [images, setImages] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [receiptData, setReceiptData] = useState(null);
    const fileInputRef = useRef(null);

    const filteredCustomers = customers.filter(c =>
        c.name.toLowerCase().includes(searchQ.toLowerCase()) ||
        c.mobile.includes(searchQ)
    );

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const compressedBlob = await compressImage(file);
            const uploadedData = await uploadToCloudinary(compressedBlob);
            setImages(prev => [...prev, uploadedData]);
        } catch (error) {
            alert('Image upload failed: ' + error.message);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleRemoveImage = (index) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    const generateWhatsAppUrl = (customer) => {
        const fmt  = (v) => parseFloat(v || 0).toFixed(2);
        const fmtG = (v) => parseFloat(v || 0).toFixed(3);
        const dir  = (v) => v >= 0 ? 'jama' : 'nave (balance)';
        const cash   = parseFloat(customer.cashBalance   || 0);
        const gold   = parseFloat(customer.goldBalance   || 0);
        const silver = parseFloat(customer.silverBalance || 0);

        const parts = [];
        if (cash   !== 0) parts.push(`Cash: ₹${fmt(Math.abs(cash))} ${dir(cash)}`);
        if (gold   !== 0) parts.push(`Gold: ${fmtG(Math.abs(gold))}g ${dir(gold)}`);
        if (silver !== 0) parts.push(`Silver: ${fmtG(Math.abs(silver))}g ${dir(silver)}`);
        const bals = parts.join('\n') || 'No outstanding balance';

        const last5 = transactions
            .filter(t => t.cid === customer.id)
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
        let mobile = (customer.mobile || '').replace(/\D/g, '');
        if (!mobile.startsWith('91')) mobile = '91' + mobile;
        return `https://wa.me/${mobile}?text=${encodeURIComponent(text)}`;
    };

    const handleSave = async () => {
        if (!selectedCustomer) return;
        if (!form.jama && !form.nave) return alert("Enter JAMA or NAVE");

        setIsSaving(true);
        try {
            const savedEntry = addTransaction({
                customerId: selectedCustomer.id,
                type: form.type,
                jama: form.jama ? parseFloat(form.jama) : 0,
                nave: form.nave ? parseFloat(form.nave) : 0,
                description: form.desc,
                date: form.date,
                time: form.time,
                due_date: form.dueDateToggle ? form.dueDate : null,
                whatsapp_sent: form.whatsapp,
                added_by: form.addedBy,
                images: images
            });

            // POP-03: If WhatsApp toggle is ON, open the pre-filled link
            if (form.whatsapp && selectedCustomer) {
                const waUrl = generateWhatsAppUrl(selectedCustomer);
                window.open(waUrl, '_blank');
            }

            // Show receipt modal
            setReceiptData({ transaction: savedEntry, customer: selectedCustomer });
        } catch (error) {
            alert("Failed to save transaction: " + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
        <div className="popup-overlay animate-fade-in">
            <div className="popup-content slide-up">
                <div className="popup-header">
                    <h3>{step === 1 ? 'Select Customer' : 'New Transaction'}</h3>
                    <button className="icon-btn" onClick={onClose}><X size={20} /></button>
                </div>

                {step === 1 && (
                    <div className="popup-body">
                        <div className="search-bar">
                            <Search size={18} className="search-icon" />
                            <input
                                type="text"
                                placeholder="Search by name or mobile..."
                                value={searchQ}
                                onChange={e => setSearchQ(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="customer-list-sm">
                            {filteredCustomers.map(c => (
                                <div
                                    key={c.id}
                                    className="customer-item-sm"
                                    onClick={() => {
                                        setSelectedCustomer(c);
                                        setStep(2);
                                    }}
                                >
                                    <div className="c-name">{c.name}</div>
                                    <div className="c-mobile">{c.mobile}</div>
                                </div>
                            ))}
                            {filteredCustomers.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No customers found.</div>
                            )}
                        </div>
                    </div>
                )}

                {step === 2 && selectedCustomer && (
                    <div className="popup-body">
                        {/* Customer Pill Summary */}
                        <div className="selected-customer-pill" onClick={() => !presetCustomerId && setStep(1)}>
                            <div style={{ flex: 1 }}>
                                <strong>{selectedCustomer.name}</strong> <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({selectedCustomer.mobile})</span>
                            </div>
                            {!presetCustomerId && <span style={{ fontSize: '0.75rem', color: 'var(--accent-blue)' }}>Change</span>}
                        </div>

                        {/* Type Picker */}
                        <div className="form-group">
                            <label>Transaction Type</label>
                            <div className="type-pills">
                                {['CASH', 'GOLD', 'SILVER'].map(t => (
                                    <button
                                        key={t}
                                        className={`type-pill ${form.type === t ? 'active tb-' + t.toLowerCase() : ''}`}
                                        onClick={() => setForm({ ...form, type: t })}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Amounts */}
                        <div className="amount-grid">
                            <div className="form-group">
                                <label className="text-green">JAMA (+)</label>
                                <input
                                    type="number"
                                    placeholder="Amount Received"
                                    value={form.jama}
                                    onChange={e => setForm({ ...form, jama: e.target.value })}
                                />
                                <span className="help-text">Given to shop</span>
                            </div>
                            <div className="form-group">
                                <label className="text-red">NAVE (-)</label>
                                <input
                                    type="number"
                                    placeholder="Amount Taken"
                                    value={form.nave}
                                    onChange={e => setForm({ ...form, nave: e.target.value })}
                                />
                                <span className="help-text">Taken from shop</span>
                            </div>
                        </div>

                        {/* Details */}
                        <div className="form-group">
                            <label>Description / Notes</label>
                            <input
                                type="text"
                                placeholder="E.g., Old gold exchange..."
                                value={form.desc}
                                onChange={e => setForm({ ...form, desc: e.target.value })}
                            />
                        </div>

                        <div className="datetime-row">
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Date</label>
                                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Time</label>
                                <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="toggles-container">
                            <label className="toggle-row">
                                <div className="toggle-info">
                                    <CalendarDays size={16} />
                                    <span>Set Due Date</span>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={form.dueDateToggle}
                                    onChange={e => setForm({ ...form, dueDateToggle: e.target.checked })}
                                />
                            </label>
                            {form.dueDateToggle && (
                                <input
                                    type="date"
                                    className="due-date-input"
                                    value={form.dueDate}
                                    onChange={e => setForm({ ...form, dueDate: e.target.value })}
                                />
                            )}

                            <label className="toggle-row">
                                <div className="toggle-info">
                                    <Phone size={16} />
                                    <span>Send WhatsApp Notification</span>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={form.whatsapp}
                                    onChange={e => setForm({ ...form, whatsapp: e.target.checked })}
                                />
                            </label>
                        </div>

                        {/* Image Upload */}
                        <div className="form-group">
                            <label>Receipt Photo</label>
                            <div className="image-uploader">
                                <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    style={{ display: 'none' }}
                                />
                                <button className="upload-btn" onClick={() => fileInputRef.current.click()} disabled={isUploading}>
                                    <Camera size={20} />
                                    {isUploading ? 'Compressing...' : 'Add Photo'}
                                </button>

                                <div className="image-preview-list">
                                    {images.map((img, i) => (
                                        <div key={i} className="image-preview-item">
                                            <img src={img.url} alt="receipt" />
                                            <button className="remove-img-btn" onClick={() => handleRemoveImage(i)}>
                                                <XCircle size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* POP-05: Added By dropdown */}
                        <div className="form-group">
                            <label>Added By</label>
                            <select
                                value={form.addedBy}
                                onChange={e => setForm({ ...form, addedBy: e.target.value })}
                                style={{
                                    width: '100%',
                                    padding: '0.6rem 0.75rem',
                                    background: 'rgba(15,23,42,0.6)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '8px',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.9rem'
                                }}
                            >
                                <option value="Owner">Owner</option>
                                <option value="Staff">Staff</option>
                            </select>
                        </div>

                    </div>
                )}

                {step === 2 && (
                    <div className="popup-footer">
                        <button className="btn-cancel" onClick={onClose} disabled={isSaving}>Cancel</button>
                        <button className="btn-save" onClick={handleSave} disabled={isSaving || (!form.jama && !form.nave)}>
                            <Check size={18} /> {isSaving ? 'Saving...' : 'Save Transaction'}
                        </button>
                    </div>
                )}
            </div>
        </div>

        {/* Receipt Modal */}
        {receiptData && (
            <ReceiptModal
                transaction={receiptData.transaction}
                customer={receiptData.customer}
                onClose={() => {
                    setReceiptData(null);
                    onClose();
                }}
            />
        )}
        </>
    );
};

export default TransactionPopup;
