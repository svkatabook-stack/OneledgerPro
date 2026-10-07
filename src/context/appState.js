import { createContext, useContext } from 'react';
export const AppContext = createContext();
export const useAppContext = () => useContext(AppContext);

// ── Supabase ↔ local data mappers ───────────────────────────────────────────

export const dbCustToLocal = (row) => ({
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    mobile2: row.mobile2 || '',
    tag: row.tag || '',
    category: row.primary_category || 'RETAIL',
    primary_category: row.primary_category || 'CASH',
    due_date: row.due_date || null,
    cashBalance:   parseFloat(row.retail_cash   || 0) + parseFloat(row.bullion_cash  || 0) + parseFloat(row.silver_cash  || 0) + parseFloat(row.chit_cash || 0),
    goldBalance:   parseFloat(row.retail_gold   || 0) + parseFloat(row.bullion_gold  || 0),
    silverBalance: parseFloat(row.bullion_silver || 0) + parseFloat(row.silver_silver || 0),
    retailCash:    parseFloat(row.retail_cash    || 0),
    retailGold:    parseFloat(row.retail_gold    || 0),
    bullionCash:   parseFloat(row.bullion_cash   || 0),
    bullionGold:   parseFloat(row.bullion_gold   || 0),
    bullionSilver: parseFloat(row.bullion_silver || 0),
    silverCash:    parseFloat(row.silver_cash    || 0),
    silverSilver:  parseFloat(row.silver_silver  || 0),
    chitCash:      parseFloat(row.chit_cash      || 0),
    createdAt: row.created_at,
});

export const dbTxToLocal = (row) => ({
    id: row.id,
    bill_number: row.bill_number || '',
    cid: row.customer_id,
    type: row.type,
    direction: row.direction,
    category: row.category,
    sub_type: row.sub_type,
    metal_type: row.type !== 'CASH' ? row.type : '',
    chit_scheme: row.chit_scheme || '',
    bill_amount: parseFloat(row.bill_amount || 0),
    grams: parseFloat(row.grams || 0),
    date: row.date,
    time: row.time,
    jama: parseFloat(row.jama || 0),
    nave: parseFloat(row.nave || 0),
    description: row.description || '',
    added_by: row.added_by || 'Staff',
    images: row.images || [],
    whatsapp_sent: row.whatsapp_sent || false,
    currentBalance: parseFloat(row.current_balance || 0),
    newBalance: parseFloat(row.new_balance || 0),
    createdAt: new Date(row.created_at).getTime(),
});

export const getCatBalKey = (category, type) => {
    if (category === 'RETAIL') {
        if (type === 'CASH') return 'retailCash';
        if (type === 'GOLD') return 'retailGold';
        return null;
    }
    if (category === 'BULLION') {
        if (type === 'CASH')   return 'bullionCash';
        if (type === 'GOLD')   return 'bullionGold';
        if (type === 'SILVER') return 'bullionSilver';
        return null;
    }
    if (category === 'SILVER') {
        if (type === 'CASH')   return 'silverCash';
        if (type === 'SILVER') return 'silverSilver';
        return null;
    }
    if (category === 'CHIT') {
        if (type === 'CASH') return 'chitCash';
        return null;
    }
    return null;
};

export const STORAGE_KEYS = [
    'oneledger_customers', 'oneledger_transactions', 'oneledger_auth', 'oneledger_chit_schemes'
];

export const MAX_CACHED_TRANSACTIONS = 1000;
