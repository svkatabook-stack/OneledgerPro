import React, { useState, useRef, useCallback, useEffect } from 'react';
import { AppContext, dbCustToLocal, dbTxToLocal } from './AppContext';
import { supabase, isSupabaseReady } from '../lib/supabase';

import { receiptReferences, clearReceiptCache } from '../lib/receiptImages';

// Cloud data never reads or writes the local demo cache.
async function allRows(table, orgId) {
    const rows = [];
    for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.from(table).select('*').eq('org_id', orgId)
            .order('id').range(from, from + 499);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 500) return rows;
    }
}

export const CloudAppProvider = ({ children }) => {
    const [customers, setCustomers] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [deletedTransactions, setDeletedTransactions] = useState([]);
    const [chitSchemes, setChitSchemes] = useState([]);
    const [authSession, setAuthSession] = useState(null);
    const [authLoading, setAuthLoading] = useState(isSupabaseReady());
    const [authError, setAuthError] = useState('');
    const [syncError, setSyncError] = useState('');
    const [isLive, setIsLive] = useState(false);
    const current = useRef(null);
    const authVersion = useRef(0);
    const loadVersion = useRef(0);

    const clearData = useCallback(() => {
        clearReceiptCache();
        loadVersion.current++;
        setCustomers([]); setTransactions([]); setDeletedTransactions([]); setChitSchemes([]);
        setSyncError(''); setIsLive(false);
    }, []);

    const refresh = useCallback(async () => {
        const session = current.current;
        if (!session) return;
        const version = ++loadVersion.current;
        try {
            const [cs, txs, schemes, profiles] = await Promise.all([
                allRows('customers', session.orgId), allRows('transactions', session.orgId),
                allRows('chit_schemes', session.orgId), allRows('profiles', session.orgId),
            ]);
            if (version !== loadVersion.current || current.current !== session) return;
            const names = Object.fromEntries(profiles.map(p => [p.id, p.display_name || p.role]));
            const mapTx = t => ({ ...dbTxToLocal(t), added_by: names[t.added_by] || t.added_by, deleted_at: t.deleted_at });
            setCustomers(cs.map(dbCustToLocal));
            setTransactions(txs.filter(t => !t.deleted_at).map(mapTx).sort((a,b) => a.createdAt-b.createdAt));
            setDeletedTransactions(txs.filter(t => t.deleted_at).map(mapTx));
            setChitSchemes(schemes.map(s => s.name));
            setSyncError('');
        } catch (error) {
            if (version === loadVersion.current && current.current === session) setSyncError(error.message);
        }
    }, []);

    useEffect(() => {
        if (!isSupabaseReady()) return;
        let disposed = false;
        const timers = new Set();
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            // Never await another Supabase request inside its auth callback.
            if (event === 'TOKEN_REFRESHED' && current.current) return;
            const version = ++authVersion.current;
            current.current = null;
            setAuthSession(null); clearData(); setAuthError('');
            setAuthLoading(!!session);
            if (!session) return;
            const timer = setTimeout(async () => {
                timers.delete(timer);
                try {
                    const { data: profile, error } = await supabase.from('profiles')
                        .select('org_id,role,display_name').eq('id', session.user.id).single();
                    if (disposed || version !== authVersion.current) return;
                    if (error || !profile?.org_id || !['owner','staff','view'].includes(profile.role)) {
                        throw new Error('Your account has no ledger access yet. Ask the administrator to link your profile.');
                    }
                    const verified = { userId: session.user.id, email: session.user.email,
                        orgId: profile.org_id, role: profile.role, displayName: profile.display_name || profile.role };
                    current.current = verified;
                    setAuthSession(verified);
                    await refresh();
                } catch (error) {
                    if (!disposed && version === authVersion.current) setAuthError(error.message);
                } finally {
                    if (!disposed && version === authVersion.current) setAuthLoading(false);
                }
            }, 0);
            timers.add(timer);
        });
        return () => { disposed = true; authVersion.current++; timers.forEach(clearTimeout); subscription.unsubscribe(); };
    }, [clearData, refresh]);

    const orgId = authSession?.orgId || null;
    useEffect(() => {
        if (!orgId) return;
        let timer;
        const reload = () => { clearTimeout(timer); timer = setTimeout(refresh, 350); };
        const channel = supabase.channel(`oneledger-${orgId}`);
        for (const table of ['customers','transactions','chit_schemes']) {
            channel.on('postgres_changes', { event:'*', schema:'public', table, filter:`org_id=eq.${orgId}` }, reload);
        }
        channel.subscribe(status => {
            setIsLive(status === 'SUBSCRIBED');
            if (status === 'SUBSCRIBED') reload();
        });
        const poll = setInterval(reload, 60000);
        const onFocus = () => { if (document.visibilityState === 'visible') reload(); };
        window.addEventListener('online', reload);
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            clearTimeout(timer); clearInterval(poll); supabase.removeChannel(channel);
            window.removeEventListener('online', reload); window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, [orgId, refresh]);

    const writer = () => {
        const session = current.current;
        if (!session || !['owner','staff'].includes(session.role)) throw new Error('Write access required.');
        return session;
    };
    const addCustomer = async data => {
        const session = writer();
        const { data: row, error } = await supabase.from('customers').insert({
            org_id: session.orgId, name: data.name.trim(), mobile: data.mobile,
            primary_category: data.primary_category || 'CASH', due_date: data.due_date || null,
        }).select().single();
        if (error) throw error;
        await refresh();
        return dbCustToLocal(row);
    };
    const updateCustomer = async (id, updates) => {
        writer();
        const allowed = Object.fromEntries(Object.entries(updates).filter(([key]) => ['name','mobile','mobile2','due_date'].includes(key)));
        const { error } = await supabase.from('customers').update(allowed).eq('id',id).select().single();
        if (error) throw error;
        await refresh();
    };
    const addTransaction = async data => {
        writer();
        const { data: row, error } = await supabase.rpc('record_transaction', { p_id: data.id || crypto.randomUUID(), p_entry: { ...data, images: receiptReferences(data.images) } });
        if (error) throw error;
        await refresh();
        return dbTxToLocal(row);
    };
    const deleteTransaction = async id => {
        if (writer().role !== 'owner') throw new Error('Owner access required.');
        const { error } = await supabase.rpc('delete_transaction', { p_transaction_id: id });
        if (error) throw error;
        await refresh();
    };
    const addChitScheme = async name => {
        const session = writer();
        const { error } = await supabase.from('chit_schemes').insert({ org_id:session.orgId, name:name.trim().toUpperCase() });
        if (error) throw error;
        await refresh();
    };
    const signOut = async () => {
        authVersion.current++; current.current = null; setAuthSession(null); clearData();
        const { error } = await supabase.auth.signOut({ scope:'local' });
        if (error) setAuthError('Sign-out could not be confirmed. Please retry when connected.');
    };
    return <AppContext.Provider value={{
        customers, transactions, deletedTransactions, chitSchemes, authSession, authLoading, authError,
        syncError, isLive, orgId, signOut, refresh,
        getCustomer:id => customers.find(c => c.id===id), getCustomerByMobile:mobile => customers.find(c => c.mobile===mobile),
        addCustomer, updateCustomer, addTransaction, deleteTransaction, addChitScheme,
        updateCustomerDueDate:(id,due_date) => updateCustomer(id,{due_date}),
        seedDummyData:() => { throw new Error('Sample data is available in local mode only.'); },
    }}>{children}</AppContext.Provider>;
};
