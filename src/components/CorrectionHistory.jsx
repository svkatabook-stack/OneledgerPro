import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/appState';
import './CorrectionHistory.css';

const PAGE_SIZE = 50;
const fields = { jama: 'You Got (Jama)', nave: 'You Gave (Nave)', bill_number: 'Bill number', bill_amount: 'Bill amount (₹)', date: 'Date', description: 'Notes' };
const display = value => value === null || value === undefined || value === '' ? '—' : String(value);
export default function CorrectionHistory() {
    const { transactions, deletedTransactions, customers, loadCorrectionsPage } = useAppContext();
    const [page, setPage] = useState(0);
    const [retry, setRetry] = useState(0);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(!!loadCorrectionsPage);
    const [error, setError] = useState('');
    const txMap = useMemo(() => new Map([...transactions, ...deletedTransactions].map(tx => [tx.id, tx])), [transactions, deletedTransactions]);
    const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers]);
    const localRows = useMemo(() => [...txMap.values()].flatMap(tx => (tx.editHistory || []).map((entry, index) => ({ ...entry, id: `${tx.id}-${index}`, transactionId: tx.id }))).sort((a, b) => new Date(b.at) - new Date(a.at)), [txMap]);
    useEffect(() => {
        if (!loadCorrectionsPage) return;
        let active = true;
        loadCorrectionsPage(page * PAGE_SIZE, PAGE_SIZE + 1).then(data => { if (active) { setRows(data); setError(''); } })
            .catch(() => { if (active) setError('Could not load correction history. Please try again.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [loadCorrectionsPage, page, retry]);
    const source = loadCorrectionsPage ? rows : localRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE + 1);
    const changePage = next => { setLoading(!!loadCorrectionsPage); setPage(next); };
    return <section className="correction-history" aria-label="All correction history">
        <p className="correction-help">Owner-only record of corrections, newest first. Includes transactions later deleted. Shared logins identify the account, not the individual.</p>
        {loading ? <p role="status">Loading correction history…</p> : error ? <div role="alert">{error} <button className="ledger-secondary-button" onClick={() => { setLoading(true); setRetry(n => n + 1); }}>Retry history</button></div> : source.length === 0 ? <p>No corrections recorded yet.</p> : <div className="correction-list">{source.slice(0, PAGE_SIZE).map(entry => {
            const tx = txMap.get(entry.transactionId);
            return <article className="correction-card" key={entry.id}>
                <header><div><strong>{customerMap.get(tx?.cid) || 'Customer unavailable'}</strong><p>{tx?.category} · {tx?.type}{tx?.type === 'CASH' ? ' (₹)' : ' (g)'} · Bill {entry.after.bill_number || tx?.bill_number || '—'}{tx?.deleted_at && <span className="correction-deleted"> · Deleted transaction</span>}</p></div><time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time></header>
                <div className="correction-table-wrap"><table><thead><tr><th>Detail</th><th>Before</th><th>After</th></tr></thead><tbody>{Object.entries(fields).filter(([key]) => entry.before[key] !== entry.after[key]).map(([key, label]) => <tr key={key}><th>{label}</th><td>{display(entry.before[key])}</td><td>{display(entry.after[key])}</td></tr>)}</tbody></table></div>
                <p><strong>Reason:</strong> {entry.reason}</p><p><strong>Changed by:</strong> {entry.by}</p>
                {entry.accountId && <details><summary>Account reference</summary><small>{entry.accountId}</small></details>}
            </article>;
        })}</div>}
        <nav className="correction-pagination" aria-label="Correction history pages"><button className="ledger-secondary-button" disabled={loading || page === 0} onClick={() => changePage(page - 1)}>Previous</button><span>Page {page + 1}</span><button className="ledger-secondary-button" disabled={loading || !!error || source.length <= PAGE_SIZE} onClick={() => changePage(page + 1)}>Next</button></nav>
    </section>;
}
