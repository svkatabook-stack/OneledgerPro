import { getCatBalKey } from '../context/appState.js';
import { canManage } from './roleAccess.js';

const fields = ['jama', 'nave', 'direction', 'grams', 'bill_amount', 'bill_number', 'date', 'description'];
const snapshot = tx => Object.fromEntries(fields.map(key => [key, tx[key] ?? null]));
const round = (value, type) => Number(value.toFixed(type === 'CASH' ? 2 : 3));

// Retain the original customer/category/type and posting order. Correct only this
// account, preserving any opening balance/history outside the local cache.
export function editTransaction({ transactions, deletedTransactions, customers, role, id, changes, expectedRevision }) {
    if (!canManage(role)) throw new Error('Only the owner can edit transactions.');
    const old = transactions.find(tx => tx.id === id);
    if (!old) throw new Error('This transaction is no longer available.');
    if ((old.editHistory?.length || 0) !== expectedRevision) throw new Error('This transaction changed. Close and reopen it before editing.');
    const customer = customers.find(c => c.id === old.cid);
    const key = getCatBalKey(old.category, old.type);
    if (!customer || !key) throw new Error('The customer or account could not be found.');
    const amount = Number(changes.amount);
    const precision = old.type === 'CASH' ? 2 : 3;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999 || Math.abs(amount - round(amount, old.type)) > 1e-7) {
        throw new Error(`Enter an amount above zero with up to ${precision} decimal places.`);
    }
    if (!['IN', 'OUT'].includes(changes.direction)) throw new Error('Choose You Got (Jama) or You Gave (Nave).');
    const bill = changes.bill_number?.trim().toUpperCase() || null;
    if (bill && bill.length > 64) throw new Error('Bill number must be 64 characters or fewer.');
    if (bill && [...transactions, ...deletedTransactions].some(t => t.id !== id && t.bill_number?.toUpperCase() === bill)) {
        throw new Error('Bill number already exists. Use a different number or leave it blank.');
    }
    const date = changes.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Enter a valid date.');
    const reason = changes.reason?.trim();
    if (!reason) throw new Error('Please enter a reason for this correction.');
    const billAmount = Number(changes.bill_amount || 0);
    if (!Number.isFinite(billAmount) || billAmount < 0 || billAmount > 999999999999 || Math.abs(billAmount - round(billAmount, 'CASH')) > 1e-7) throw new Error('Enter a valid bill amount with up to 2 decimal places.');
    const updated = { ...old, jama: changes.direction === 'IN' ? amount : 0, nave: changes.direction === 'OUT' ? amount : 0,
        direction: changes.direction, grams: old.type === 'CASH' ? old.grams : amount,
        bill_number: bill, bill_amount: billAmount, date, description: changes.description?.trim() || '' };
    if (JSON.stringify(snapshot(old)) === JSON.stringify(snapshot(updated))) throw new Error('No changes to save.');
    updated.editHistory = [...(old.editHistory || []), { at: new Date().toISOString(), by: role, reason, before: snapshot(old), after: snapshot(updated) }];
    const correction = (updated.jama - updated.nave) - (old.jama - old.nave);
    const aggregate = { CASH: 'cashBalance', GOLD: 'goldBalance', SILVER: 'silverBalance' }[old.type];
    const nextCustomers = customers.map(c => c.id === old.cid ? { ...c,
        [key]: round(Number(c[key] || 0) + correction, old.type),
        [aggregate]: round(Number(c[aggregate] || 0) + correction, old.type) } : c);
    const sameAccount = tx => tx.cid === old.cid && tx.category === old.category && tx.type === old.type;
    let running = round(Number(customer[key] || 0) - transactions.filter(sameAccount).reduce((sum, tx) => sum + tx.jama - tx.nave, 0), old.type);
    const corrected = new Map();
    transactions.filter(sameAccount).sort((a, b) => a.createdAt - b.createdAt).forEach(tx => {
        const next = tx.id === id ? updated : tx;
        const before = running;
        running = round(running + next.jama - next.nave, old.type);
        corrected.set(tx.id, { ...next, currentBalance: before, newBalance: running });
    });
    return { customers: nextCustomers, transactions: transactions.map(tx => corrected.get(tx.id) || tx) };
}
