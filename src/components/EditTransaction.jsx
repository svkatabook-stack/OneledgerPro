import { useEffect, useRef, useState } from 'react';
import { X, Pencil } from 'lucide-react';
import { useAppContext, getCatBalKey } from '../context/appState';
import './EditTransaction.css';

export default function EditTransaction({ transaction: tx, onClose, onSaved }) {
    const { updateTransaction, loadCorrectionHistory, customers } = useAppContext();
    const dialog = useRef(null);
    const attempt = useRef(null);
    const [history, setHistory] = useState(tx.editHistory || []);
    const [historyError, setHistoryError] = useState('');
    const [historyLoading, setHistoryLoading] = useState(!!loadCorrectionHistory);
    useEffect(() => {
        if (!loadCorrectionHistory) return;
        let active = true;
        loadCorrectionHistory(tx.id).then(rows => { if (active) setHistory(rows); })
            .catch(() => { if (active) setHistoryError('Correction history could not be loaded. Close and reopen to retry.'); })
            .finally(() => { if (active) setHistoryLoading(false); });
        return () => { active = false; };
    }, [loadCorrectionHistory, tx.id]);
    const [form, setForm] = useState({ amount: String(tx.jama || tx.nave), direction: tx.jama > 0 ? 'IN' : 'OUT',
        bill_number: tx.bill_number || '', date: tx.date, description: tx.description || '', bill_amount: String(tx.bill_amount || 0), reason: '' });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const customer = customers.find(c => c.id === tx.cid);
    const cash = tx.type === 'CASH';
    const fmt = value => `${cash ? '₹' : ''}${Number(value).toLocaleString('en-IN', { minimumFractionDigits: cash ? 2 : 3, maximumFractionDigits: cash ? 2 : 3 })}${cash ? '' : ' g'}`;
    const current = Number(customer?.[getCatBalKey(tx.category, tx.type)] || 0);
    const delta = (form.direction === 'IN' ? 1 : -1) * Number(form.amount) - (tx.jama - tx.nave);
    const change = event => setForm(prev => ({ ...prev, [event.target.name]: event.target.value }));
    useEffect(() => { dialog.current.showModal(); }, []);
    const save = async event => {
        event.preventDefault();
        if (saving) return;
        setSaving(true); setError('');
        try {
            const payload = JSON.stringify(form);
            if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
            const synced = await updateTransaction(tx.id, form, tx.revision ?? tx.editHistory?.length ?? 0, attempt.current.id);
            onSaved(synced);
        } catch (err) { setError(err.message); setSaving(false); }
    };
    return <dialog ref={dialog} className="tx-edit-dialog" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} aria-labelledby="tx-edit-title">
        <form onSubmit={save}>
            <header className="tx-edit-header">
                <div><span className="tx-edit-eyebrow">OWNER CORRECTION</span><h2 id="tx-edit-title"><Pencil size={20} /> Edit transaction</h2></div>
                <button type="button" className="icon-btn" aria-label="Close edit" onClick={onClose} disabled={saving}><X /></button>
            </header>
            <div className="tx-edit-body">
                <div className="tx-edit-account"><strong>{customer?.name}</strong><span>{tx.category} · {tx.sub_type} {tx.chit_scheme && `· ${tx.chit_scheme}`}</span></div>
                <p className="tx-edit-help">Correct this entry below. Customer, account and attached photos stay the same. Balances follow the original entry order.</p>
                <div className="tx-edit-grid">
                    <label>Transaction direction<select name="direction" value={form.direction} onChange={change}><option value="IN">You Got (Jama)</option><option value="OUT">You Gave (Nave)</option></select></label>
                    <label>{cash ? 'Amount (₹)' : 'Weight (g)'}<input autoFocus name="amount" type="number" min={cash ? '0.01' : '0.001'} step={cash ? '0.01' : '0.001'} max="999999999999" value={form.amount} onChange={change} required /></label>
                    <label>Bill number (optional)<input name="bill_number" maxLength={64} value={form.bill_number} onChange={change} placeholder="e.g. BILL-101" /></label>
                    <label>Transaction date<input name="date" type="date" value={form.date} onChange={change} required /></label>
                    <label>Bill amount (₹, optional)<input name="bill_amount" type="number" min="0" step="0.01" max="999999999999" value={form.bill_amount} onChange={change} /></label>
                </div>
                <label>Notes<textarea name="description" rows={2} maxLength={2000} value={form.description} onChange={change} /></label>
                <div className="tx-edit-preview"><span>Customer’s {tx.category.toLowerCase()} {tx.type.toLowerCase()} balance</span><div><strong>{fmt(current)}</strong><span>→</span><strong>{Number.isFinite(delta) && Number(form.amount) > 0 ? fmt(current + delta) : '—'}</strong></div><small>Later entries in this account will have their running balances corrected.</small></div>
                <label>Reason for correction<textarea name="reason" rows={2} maxLength={500} value={form.reason} onChange={change} placeholder="e.g. Amount entered incorrectly" required /></label>
                {!!history.length && <details className="tx-edit-history"><summary>Correction history ({history.length})</summary>{[...history].reverse().map((entry, i) => <article key={i}><strong>{new Date(entry.at).toLocaleString()} · {entry.by}</strong>{entry.accountId && <p>Account: {entry.accountId}</p>}<p>{entry.reason}</p><p>{entry.before.direction === 'IN' ? 'You Got (Jama)' : 'You Gave (Nave)'} {fmt(entry.before.jama || entry.before.nave)} → {entry.after.direction === 'IN' ? 'You Got (Jama)' : 'You Gave (Nave)'} {fmt(entry.after.jama || entry.after.nave)}</p>{[['bill_number', 'Bill number'], ['date', 'Date'], ['description', 'Notes'], ['bill_amount', 'Bill amount (₹)']].filter(([key]) => entry.before[key] !== entry.after[key]).map(([key, label]) => <p key={key}>{label}: {String(entry.before[key] ?? '—')} → {String(entry.after[key] ?? '—')}</p>)}</article>)}</details>}
                {historyLoading && <p className="tx-edit-help">Loading correction history…</p>}
                {historyError && <p role="alert" className="tx-edit-error">{historyError}</p>}
                {error && <p className="tx-edit-error" role="alert">{error}</p>}
            </div>
            <footer className="tx-edit-footer"><button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="tx-edit-save" disabled={saving}>{saving ? 'Saving…' : 'Save correction'}</button></footer>
        </form>
    </dialog>;
}
