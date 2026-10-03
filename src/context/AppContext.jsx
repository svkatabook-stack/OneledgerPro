import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseReady, cleanupSupabaseStorage } from '../lib/supabase';

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

const getInitialData = (key, def) => {
    try {
        const s = localStorage.getItem(key);
        return s ? JSON.parse(s) : def;
    } catch { return def; }
};

const newId = () => crypto.randomUUID();
const n = (v) => parseFloat(v || 0);
const r2 = (v) => Math.round(v * 100) / 100;    // round to 2 decimal places (cash ₹)
const r3 = (v) => Math.round(v * 1000) / 1000;  // round to 3 decimal places (grams)

// Maps category + type → per-category balance field name on the customer object.
// This is the single source of truth for balance isolation across categories.
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

const GRAMS_KEYS = new Set(['retailGold', 'bullionGold', 'bullionSilver', 'silverSilver']);

// Migration: populate per-category balance fields from transaction history for customers that pre-date this feature.
const migrateCustomers = (custs, txs) => {
    if (custs.length === 0) return custs;
    if (custs.every(c => c.retailCash !== undefined)) return custs; // already migrated
    return custs.map(c => {
        if (c.retailCash !== undefined) return c;
        const bals = { retailCash: 0, retailGold: 0, bullionCash: 0, bullionGold: 0, bullionSilver: 0, silverCash: 0, silverSilver: 0, chitCash: 0 };
        txs.filter(t => t.cid === c.id).forEach(t => {
            const key = getCatBalKey(t.category, t.type);
            if (key !== null) bals[key] += n(t.jama) - n(t.nave);
        });
        Object.keys(bals).forEach(k => {
            bals[k] = GRAMS_KEYS.has(k) ? r3(bals[k]) : r2(bals[k]);
        });
        return { ...c, ...bals };
    });
};

export const STORAGE_KEYS = [
    'oneledger_customers', 'oneledger_transactions', 'oneledger_auth', 'oneledger_chit_schemes'
];

export const MAX_CACHED_TRANSACTIONS = 1000;

const DEFAULT_CHIT_SCHEMES = ['CHIT', 'DIWALI FUND', 'GOLD SCHEME', 'SILVER SCHEME', 'MONTHLY SCHEME'];

export const AppProvider = ({ children }) => {
    const [customers,    setCustomers]    = useState(() => {
        const custs = getInitialData('oneledger_customers', []);
        const txs   = getInitialData('oneledger_transactions', []);
        return migrateCustomers(custs, txs);
    });
    const [transactions,        setTransactions]        = useState(() => getInitialData('oneledger_transactions', []));
    const [deletedTransactions, setDeletedTransactions] = useState(() => getInitialData('oneledger_deleted_transactions', []));
    const [authSession,         setAuthSession]         = useState(() => getInitialData('oneledger_auth', null));
    const [chitSchemes,         setChitSchemes]         = useState(() => getInitialData('oneledger_chit_schemes', DEFAULT_CHIT_SCHEMES));

    // Supabase session context (set once authenticated)
    const dbOrgId             = useRef(null);
    const dbUserId            = useRef(null);
    const channelRef          = useRef(null);
    const handlingSession     = useRef(false); // guard: only one handleSession runs at a time
    const handleSessionCallId = useRef(0);     // increments per call — stale calls self-abort
    const lastFetchRef        = useRef(0);     // ms timestamp of last full DB fetch — egress guard
    const profilesMapRef      = useRef({});    // uuid → display_name, set on every full fetch
    const [orgId, setOrgId]   = useState(null);
    const [isLive, setIsLive] = useState(true); // false = Realtime offline, show reconnecting UI

    useEffect(() => { localStorage.setItem('oneledger_customers',            JSON.stringify(customers));           }, [customers]);
    useEffect(() => { localStorage.setItem('oneledger_transactions',         JSON.stringify(transactions.slice(-MAX_CACHED_TRANSACTIONS))); }, [transactions]);
    useEffect(() => { localStorage.setItem('oneledger_deleted_transactions', JSON.stringify(deletedTransactions)); }, [deletedTransactions]);
    useEffect(() => { localStorage.setItem('oneledger_auth',                 JSON.stringify(authSession));         }, [authSession]);
    useEffect(() => { localStorage.setItem('oneledger_chit_schemes',         JSON.stringify(chitSchemes));         }, [chitSchemes]);

    // ── Push local customers + transactions up to a fresh Supabase org ───────
    const pushLocalToSupabase = useCallback(async (orgId, userId, localCusts, localTxs, displayName = 'owner') => {
        console.log(`[Supabase] Migrating ${localCusts.length} customers, ${localTxs.length} transactions to cloud…`);

        for (const c of localCusts) {
            const { error } = await supabase.from('customers').insert({
                id: c.id, org_id: orgId,
                name: c.name, mobile: c.mobile,
                primary_category: c.primary_category || 'CASH',
                due_date: c.due_date || null,
                retail_cash: c.retailCash || 0, retail_gold: c.retailGold || 0,
                bullion_cash: c.bullionCash || 0, bullion_gold: c.bullionGold || 0,
                bullion_silver: c.bullionSilver || 0,
                silver_cash: c.silverCash || 0, silver_silver: c.silverSilver || 0,
                chit_cash: c.chitCash || 0,
            });
            if (error && error.code !== '23505') // ignore duplicate key
                console.error('[Supabase] migrate customer:', error);
        }

        for (const tx of localTxs) {
            const { error } = await supabase.from('transactions').insert({
                id: tx.id, org_id: orgId,
                customer_id: tx.cid,
                category: tx.category, sub_type: tx.sub_type,
                type: tx.type, direction: tx.direction,
                jama: tx.jama, nave: tx.nave,
                grams: tx.grams || 0, bill_amount: tx.bill_amount || 0,
                chit_scheme: tx.chit_scheme || '',
                description: tx.description || '',
                date: tx.date, time: tx.time,
                added_by: displayName,
                images: tx.images || [],
                current_balance: tx.currentBalance || 0,
                new_balance: tx.newBalance || 0,
            });
            if (error && error.code !== '23505')
                console.error('[Supabase] migrate tx:', error);
        }
        console.log('[Supabase] Migration complete.');
    }, []);

    // ── Load all data from Supabase for a given org ──────────────────────────
    const loadFromSupabase = useCallback(async (orgId, userId, displayName = 'owner', isInitial = false) => {
        // Query customers and profiles (tiny tables, always load fully to handle hard deletes safely)
        const [{ data: custs, error: ce }, { data: profiles }] = await Promise.all([
            supabase.from('customers').select('*').eq('org_id', orgId).order('created_at'),
            supabase.from('profiles').select('id, display_name, role').eq('org_id', orgId),
        ]);

        if (ce) { console.error('[Supabase] load customers:', ce); return; }

        // Build UUID → display name map so "By" column shows names not UUIDs
        const uuidNameMap = {};
        (profiles || []).forEach(p => { uuidNameMap[p.id] = p.display_name || p.role || 'staff'; });
        profilesMapRef.current = uuidNameMap; // cache for Realtime row-merge handlers
        const txToLocal = (tx) => ({ ...dbTxToLocal(tx), added_by: uuidNameMap[tx.added_by] || tx.added_by });

        const localCusts = (custs || []).map(dbCustToLocal);
        setCustomers(localCusts);
        localStorage.setItem('oneledger_customers', JSON.stringify(localCusts));

        const shouldDoFullSync = isInitial || !lastFetchRef.current;

        if (shouldDoFullSync) {
            console.log('[Supabase] Initial sync: loading full transactions history...');
            const { data: txs, error: te } = await supabase
                .from('transactions')
                .select('*')
                .eq('org_id', orgId)
                .is('deleted_at', null)
                .order('date')
                .order('time')
                .limit(50000);

            if (te) { console.error('[Supabase] load transactions:', te); return; }

            if (custs && custs.length === 0) {
                // Supabase is empty — check if localStorage has data to migrate up
                const localCustsCached = getInitialData('oneledger_customers', []);
                const localTxsCached   = getInitialData('oneledger_transactions', []);
                if (localCustsCached.length > 0) {
                    await pushLocalToSupabase(orgId, userId, localCustsCached, localTxsCached, displayName);
                    // Re-fetch after migration
                    const [{ data: fresh }, { data: freshTx }] = await Promise.all([
                        supabase.from('customers').select('*').eq('org_id', orgId).order('created_at'),
                        supabase.from('transactions').select('*').eq('org_id', orgId).is('deleted_at', null).order('date').order('time').limit(50000)
                    ]);
                    if (fresh)   { setCustomers(fresh.map(dbCustToLocal)); localStorage.setItem('oneledger_customers', JSON.stringify(fresh.map(dbCustToLocal))); }
                    if (freshTx) { setTransactions(freshTx.map(txToLocal)); localStorage.setItem('oneledger_transactions', JSON.stringify(freshTx.map(txToLocal).slice(-MAX_CACHED_TRANSACTIONS))); }
                }
                lastFetchRef.current = Date.now();
                return;
            }

            const localTxs = (txs || []).map(txToLocal);
            setTransactions(localTxs);
            localStorage.setItem('oneledger_transactions', JSON.stringify(localTxs.slice(-MAX_CACHED_TRANSACTIONS)));
            lastFetchRef.current = Date.now(); // record fetch time for egress cooldown
        } else {
            // Incremental sync (Option A)
            const BUFFER_MS = 5000; // 5-second clock skew buffer
            const lastFetchWithBuffer = lastFetchRef.current - BUFFER_MS;
            const lastFetchIso = new Date(lastFetchWithBuffer).toISOString();

            const { data: incTxs, error: te } = await supabase
                .from('transactions')
                .select('*')
                .eq('org_id', orgId)
                .or(`created_at.gt.${lastFetchIso},deleted_at.gt.${lastFetchIso}`)
                .order('created_at', { ascending: false })
                .limit(5000); // safety cap

            if (te) { console.error('[Supabase] load incremental transactions:', te); return; }

            if (incTxs && incTxs.length > 0) {
                console.log(`[Supabase] Incremental sync: merging ${incTxs.length} new/deleted transactions...`);
                setTransactions(prevTransactions => {
                    // Create a map of existing transactions for quick lookup (O(n) performance)
                    const transactionMap = new Map(prevTransactions.map(t => [t.id, t]));

                    // Merge incremental changes
                    incTxs.forEach(newTx => {
                        if (newTx.deleted_at) {
                            transactionMap.delete(newTx.id);
                        } else {
                            transactionMap.set(newTx.id, txToLocal(newTx));
                        }
                    });

                    // Convert back to array and sort by date/time ascending
                    const mergedTransactions = Array.from(transactionMap.values())
                        .sort((a, b) => a.createdAt - b.createdAt);

                    // Update localStorage with sliced version
                    const slicedData = mergedTransactions.slice(-MAX_CACHED_TRANSACTIONS);
                    localStorage.setItem('oneledger_transactions', JSON.stringify(slicedData));
                    return mergedTransactions;
                });
            }
            lastFetchRef.current = Date.now();
        }
    }, [pushLocalToSupabase]);

    // ── Effect 1: Auth Dictator — runs ONCE on mount, never re-runs ─────────────
    //   The SOLE authority over session state. Realtime events have zero authority here.
    //   orgId is only ever set/cleared from this effect — not from Realtime.
    useEffect(() => {
        if (!isSupabaseReady()) return;

        const EMAIL_ROLE = {
            'owner@example.invalid': 'owner',
            'staff@example.invalid': 'staff',
            'view@example.invalid':  'view',
        };

        // handleSession — initialises the session after a Supabase auth event.
        //
        // Guard: only one call runs at a time. force=true (used by SIGNED_IN) clears a
        //   stale guard so a TOKEN_REFRESHED in-flight never blocks the login spinner.
        //
        // Call-ID: each invocation stamps itself. If SIGNED_IN starts while INITIAL_SESSION
        //   is still awaiting the profile fetch, INITIAL_SESSION self-aborts before touching
        //   any state — preventing a race where both calls write setOrgId/setAuthSession.
        //
        // 8s timeout: a network stall on the profile fetch would otherwise hold handlingSession=true
        //   forever, freezing every future login attempt. We race against a timeout, fall back
        //   to localStorage mode, and always release the guard in finally.
        //   Timer is cleared immediately after Promise.race to prevent phantom unhandled rejection
        //   errors (the timeout's reject() firing 7s after a fast fetch already resolved).
        const handleSession = async (session, force = false) => {
            if (!session) { console.log('[Auth] handleSession: no session, skipping'); return; }
            if (handlingSession.current && !force) {
                console.warn('[Auth] handleSession: already running, skipping (not force)');
                return;
            }
            if (force && handlingSession.current) {
                console.warn('[Auth] handleSession: force-clearing stale guard for SIGNED_IN');
            }
            handlingSession.current = true;
            const callId = ++handleSessionCallId.current;
            console.log('[Auth] handleSession starting | callId:', callId, '| user:', session.user.email);

            try {
                dbUserId.current = session.user.id;

                let fetchTimerId;
                const fetchPromise = supabase
                    .from('profiles')
                    .select('org_id, role, display_name')
                    .eq('id', session.user.id)
                    .single();
                const timeoutPromise = new Promise((_, reject) => {
                    fetchTimerId = setTimeout(
                        () => reject(new Error('Profile fetch timed out after 8s')), 8000
                    );
                });

                const { data: profile, error: profErr } = await Promise.race([fetchPromise, timeoutPromise])
                    .catch(err => {
                        console.warn('[Auth] Profile fetch failed:', err.message);
                        return { data: null, error: err };
                    });

                clearTimeout(fetchTimerId); // kill timer immediately — prevents phantom rejection errors

                if (callId !== handleSessionCallId.current) {
                    console.log('[Auth] handleSession: stale callId', callId, '— newer call active, aborting');
                    return;
                }

                console.log('[Auth] profile | org_id:', profile?.org_id, '| role:', profile?.role, '| err:', profErr?.message);

                if (profile?.org_id) {
                    dbOrgId.current = profile.org_id;
                    const displayName = profile.display_name || profile.role || 'staff';
                    setAuthSession({ role: profile.role || 'staff', displayName, orgId: profile.org_id });
                    setOrgId(profile.org_id); // ← this is what activates Effect 2 (Realtime)
                    loadFromSupabase(profile.org_id, session.user.id, displayName, true);
                    console.log('[Auth] handleSession complete — org_id set, data loading');
                } else {
                    // Offline / profile missing / timeout — fall back to role from email mapping
                    const role = EMAIL_ROLE[session.user.email] || 'staff';
                    console.warn('[Auth] No org_id — localStorage fallback, role:', role);
                    setAuthSession({ role });
                }
            } catch (err) {
                // True safety net — should not be reachable given the .catch above
                if (callId === handleSessionCallId.current) {
                    console.error('[Auth] handleSession unexpected error:', err.message);
                    setAuthSession({ role: EMAIL_ROLE[session.user.email] || 'staff' });
                }
            } finally {
                // Only release the guard if we are still the active call.
                // If SIGNED_IN (force=true) started after us, it owns the guard — don't release it.
                if (callId === handleSessionCallId.current) {
                    handlingSession.current = false;
                }
            }
        };

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('[Auth]', event, '| session:', !!session, '| orgId:', !!dbOrgId.current, '| guard:', handlingSession.current);

            if (event === 'INITIAL_SESSION') {
                await handleSession(session);

            } else if (event === 'SIGNED_IN') {
                // Explicit login — always takes priority.
                // force=true clears any stale guard left by a TOKEN_REFRESHED that was
                // running while the tab was idle (which would otherwise block this).
                await handleSession(session, true);

            } else if (event === 'TOKEN_REFRESHED') {
                // The Supabase SDK automatically pipes the new JWT into the existing
                // WebSocket connection — the Realtime channel keeps running with no action.
                // We only update our local ref so future DB writes use the right user ID.
                if (session) {
                    dbUserId.current = session.user.id;
                    console.log('[Auth] TOKEN_REFRESHED — userId ref updated, channel untouched');
                }

            } else if (event === 'SIGNED_OUT') {
                // Two sources: (1) signOut() — dbOrgId already null, this is a no-op.
                //              (2) True session expiry (refresh failed after retries) — clear everything.
                // Realtime CLOSED/CHANNEL_ERROR never calls setOrgId(null), so this event
                // can only arrive from these two legitimate sources. No debounce needed.
                if (dbOrgId.current) {
                    console.log('[Auth] SIGNED_OUT — true expiry, clearing state');
                    dbOrgId.current  = null;
                    dbUserId.current = null;
                    setOrgId(null);        // ← Effect 2 cleanup runs, channel removed
                    setAuthSession(null);
                } else {
                    console.log('[Auth] SIGNED_OUT — already cleared (signOut path), ignoring');
                }
            }
        });

        return () => { subscription.unsubscribe(); };
    }, []); // ← empty deps — auth listener is set up once and never rebuilt

    // ── Effect 2: Realtime Consumer — obedient, dumb, no auth authority ─────────
    //   Reacts to orgId only. orgId changes on real login/logout — NOT on token refreshes.
    //   So this effect never tears down and rebuilds the channel during a JWT rotation.
    //   The Supabase SDK silently rotates the token in the WebSocket. We do nothing.
    //
    //   Realtime status events NEVER touch setOrgId, setAuthSession, or dbOrgId.
    //   CLOSED/CHANNEL_ERROR = network event only. setIsLive(false) for UI indicator.
    //   Auth state is the dictator. This effect is just a data-delivery consumer.
    useEffect(() => {
        if (!orgId) return; // not logged in — nothing to subscribe to

        // ── Helper: merge a single tx DB row into state without a full refetch ──
        const mergeTx = (row) => ({
            ...dbTxToLocal(row),
            added_by: profilesMapRef.current[row.added_by] || row.added_by,
        });

        // ── Customers-only refetch (tiny table, needed after balance updates) ──
        let custDebounce;
        const reloadCustomers = () => {
            clearTimeout(custDebounce);
            custDebounce = setTimeout(async () => {
                if (!dbOrgId.current) return;
                const { data } = await supabase
                    .from('customers').select('*')
                    .eq('org_id', dbOrgId.current).order('created_at');
                if (data) setCustomers(data.map(dbCustToLocal));
            }, 600);
        };

        const channel = supabase
            .channel(`org-${orgId}`)
            // INSERT: merge new row directly into state — zero full-table fetch
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, ({ new: row }) => {
                setTransactions(prev => [...prev, mergeTx(row)]);
                reloadCustomers(); // balance columns changed on the customer row
            })
            // UPDATE: patch the matching row in state (handles soft-deletes too)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, ({ new: row }) => {
                if (row.deleted_at) {
                    setTransactions(prev => prev.filter(t => t.id !== row.id));
                } else {
                    setTransactions(prev => prev.map(t => t.id === row.id ? mergeTx(row) : t));
                }
            })
            // DELETE: remove by id
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transactions' }, ({ old: row }) => {
                setTransactions(prev => prev.filter(t => t.id !== row.id));
            })
            // Customers: only refetch the customers table (not transactions)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, reloadCustomers)
            .subscribe((status) => {
                console.log('[Realtime] channel status:', status);
                if (status === 'SUBSCRIBED') {
                    // Reconnected — full catch-up to recover any events missed while offline.
                    // Bypasses the cooldown guard deliberately (we don't know what we missed).
                    setIsLive(true);
                    if (dbOrgId.current) {
                        lastFetchRef.current = Date.now();
                        loadFromSupabase(dbOrgId.current, dbUserId.current);
                    }
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    setIsLive(false);
                    console.warn('[Realtime] channel offline — Supabase auto-reconnecting');
                }
            });
        channelRef.current = channel;

        // 30s poll — backstop for any events dropped while Realtime is offline.
        // Updates lastFetchRef so the cooldown guard knows a fetch just happened.
        const pollInterval = setInterval(() => {
            if (dbOrgId.current && !isLive) {
                lastFetchRef.current = Date.now();
                loadFromSupabase(dbOrgId.current, dbUserId.current);
            }
        }, 30000);

        // 30-second cooldown guard — prevents rapid-fire focus/visibility/online events
        // from each triggering a full DB fetch. A single fetch covers all of them.
        // PWA waking from an 8-hour sleep still gets an immediate refetch because
        // lastFetchRef.current is far in the past (> 30s ago).
        const guardedLoad = () => {
            const now = Date.now();
            if (now - lastFetchRef.current < 30000) return;
            lastFetchRef.current = now;
            if (dbOrgId.current) loadFromSupabase(dbOrgId.current, dbUserId.current);
        };

        // Silent catch-up on tab/window focus
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') guardedLoad();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Network restored — mobile switching WiFi↔cellular, phone waking from sleep
        const handleOnline = () => guardedLoad();
        window.addEventListener('online', handleOnline);

        // iOS PWA fallback — visibilitychange can be unreliable on homescreen apps
        const handleFocus = () => guardedLoad();
        window.addEventListener('focus', handleFocus);

        // Cleanup
        return () => {
            clearTimeout(custDebounce);
            clearInterval(pollInterval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('focus', handleFocus);
            supabase.removeChannel(channel);
            channelRef.current = null;
        };
    }, [orgId, loadFromSupabase]);

    const addChitScheme = (name) => {
        const trimmed = name.trim().toUpperCase();
        if (!trimmed) return;
        setChitSchemes(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
    };

    const removeChitScheme = (name) => {
        if (DEFAULT_CHIT_SCHEMES.includes(name)) return; // protect defaults
        setChitSchemes(prev => prev.filter(s => s !== name));
    };

    const getCustomer = useCallback((id) => customers.find(c => c.id === id), [customers]);
    const getCustomerByMobile = useCallback((mobile) => customers.find(c => c.mobile === mobile), [customers]);

    const addCustomer = (data) => {
        const cId = newId();
        const c = {
            id: cId,
            name: data.name,
            mobile: data.mobile,
            tag: data.tag || '',
            category: data.category || 'RETAIL',
            primary_category: data.primary_category || 'CASH',
            due_date: data.due_date || null,
            cashBalance: 0,
            goldBalance: 0,
            silverBalance: 0,
            // Per-category isolated balances
            retailCash: 0, retailGold: 0,
            bullionCash: 0, bullionGold: 0, bullionSilver: 0,
            silverCash: 0, silverSilver: 0,
            chitCash: 0,
            createdAt: new Date().toISOString()
        };

        const initialTxs = [];
        const dStr = data.date || new Date().toISOString().split('T')[0];
        const tStr = data.time ? `${data.time}:00` : new Date().toTimeString().split(' ')[0];

        ['CASH', 'GOLD', 'SILVER'].forEach(type => {
            const initialVal = n(data[`initial${type}`]);
            if (initialVal !== 0) {
                const isJama = initialVal > 0;
                const amt = Math.abs(initialVal);
                const catMap = { CASH: 'RETAIL', GOLD: 'BULLION', SILVER: 'SILVER' };

                initialTxs.push({
                    id: newId(),
                    cid: cId,
                    type: type,
                    direction: isJama ? 'IN' : 'OUT',
                    category: catMap[type],
                    sub_type: type,
                    metal_type: type !== 'CASH' ? type : '',
                    chit_scheme: '',
                    bill_amount: 0,
                    grams: type !== 'CASH' ? amt : 0,
                    date: dStr,
                    time: tStr,
                    jama: isJama ? amt : 0,
                    nave: isJama ? 0 : amt,
                    description: 'Opening Balance',
                    added_by: 'Owner',
                    images: data.initialImages || [],
                    whatsapp_sent: false,
                    currentBalance: 0,
                    newBalance: initialVal,
                    createdAt: Date.now()
                });

                if (type === 'CASH')   { c.cashBalance = initialVal;   c.retailCash   = initialVal; }
                if (type === 'GOLD')   { c.goldBalance = initialVal;   c.bullionGold  = initialVal; }
                if (type === 'SILVER') { c.silverBalance = initialVal; c.silverSilver = initialVal; }
            }
        });

        setCustomers(prev => [...prev, c]);

        if (initialTxs.length > 0) {
            setTransactions(prev => [...prev, ...initialTxs]);
        }

        // ── Sync to Supabase (fire-and-forget) ─────────────────────────────
        if (isSupabaseReady() && dbOrgId.current) {
            const orgId = dbOrgId.current;
            supabase.from('customers').insert({
                id: c.id,
                org_id: orgId,
                name: c.name,
                mobile: c.mobile,
                primary_category: c.primary_category,
                due_date: c.due_date || null,
            }).then(({ error }) => {
                if (error) console.error('[Supabase] addCustomer:', error);
            });

            for (const tx of initialTxs) {
                supabase.rpc('add_transaction', {
                    p_org_id:      orgId,
                    p_customer_id: tx.cid,
                    p_category:    tx.category,
                    p_sub_type:    tx.sub_type,
                    p_type:        tx.type,
                    p_jama:        tx.jama,
                    p_nave:        tx.nave,
                    p_grams:       tx.grams,
                    p_bill_amount: tx.bill_amount || 0,
                    p_chit_scheme: tx.chit_scheme || '',
                    p_description: tx.description || '',
                    p_date:        tx.date,
                    p_time:        tx.time,
                    p_added_by:    dbUserId.current,
                    p_images:      tx.images || [],
                    p_current_bal: tx.currentBalance,
                    p_new_bal:     tx.newBalance,
                    p_due_date:    null,
                }).then(({ error }) => {
                    if (error) console.error('[Supabase] addCustomer initialTx:', error);
                });
            }
        }

        return c;
    };

    const updateCustomer = (id, updates) => {
        setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));

        // Sync to Supabase
        if (isSupabaseReady() && dbOrgId.current) {
            const dbUpdates = {};
            if (updates.name    !== undefined) dbUpdates.name    = updates.name;
            if (updates.mobile  !== undefined) dbUpdates.mobile  = updates.mobile;
            if (updates.mobile2 !== undefined) dbUpdates.mobile2 = updates.mobile2;
            if (Object.keys(dbUpdates).length) {
                supabase.from('customers')
                    .update({ ...dbUpdates, updated_at: new Date().toISOString() })
                    .eq('id', id)
                    .then(({ error }) => { if (error) console.error('[Supabase] updateCustomer:', error); });
            }
        }
    };

    const updateCustomerDueDate = (customerId, newDueDate) => {
        setCustomers(prev => prev.map(c => {
            if (c.id !== customerId) return c;
            return { ...c, due_date: newDueDate };
        }));

        if (isSupabaseReady() && dbOrgId.current) {
            supabase.from('customers')
                .update({ due_date: newDueDate, updated_at: new Date().toISOString() })
                .eq('id', customerId)
                .then(({ error }) => {
                    if (error) console.error('[Supabase] updateDueDate:', error);
                });
        }
    };

    const _updateBalances = (customerId, { cash = 0, gold = 0, silver = 0, category = '' }) => {
        setCustomers(prev => prev.map(c => {
            if (c.id !== customerId) return c;
            const updates = {};
            if (cash !== 0) {
                updates.cashBalance = r2(n(c.cashBalance) + cash);
                const key = getCatBalKey(category, 'CASH');
                if (key) updates[key] = r2(n(c[key] || 0) + cash);
            }
            if (gold !== 0) {
                updates.goldBalance = r3(n(c.goldBalance) + gold);
                const key = getCatBalKey(category, 'GOLD');
                if (key) updates[key] = r3(n(c[key] || 0) + gold);
            }
            if (silver !== 0) {
                updates.silverBalance = r3(n(c.silverBalance) + silver);
                const key = getCatBalKey(category, 'SILVER');
                if (key) updates[key] = r3(n(c[key] || 0) + silver);
            }
            return { ...c, ...updates };
        }));
    };

    const addTransaction = (data) => {
        const c = customers.find(x => x.id === data.customerId);
        let prevBal = 0;

        // Use the category-isolated balance as the baseline for this transaction
        const catKey = getCatBalKey(data.category, data.type);
        if (catKey && c?.[catKey] !== undefined) {
            prevBal = n(c[catKey]);
        } else if (data.type === 'CASH') {
            prevBal = n(c?.cashBalance);
        } else if (data.type === 'GOLD') {
            prevBal = n(c?.goldBalance);
        } else if (data.type === 'SILVER') {
            prevBal = n(c?.silverBalance);
        }

        const jama = n(data.jama);
        const nave = n(data.nave);
        const delta = jama - nave;

        // direction is explicit: IN = shop received, OUT = shop gave
        const direction = jama > 0 ? 'IN' : 'OUT';

        const entry = {
            id: newId(),
            cid: data.customerId,
            type: data.type || 'CASH',
            direction,                                    // 'IN' | 'OUT'
            category:    data.category    || 'RETAIL',
            sub_type:    data.sub_type    || 'CASH',
            metal_type:  data.metal_type  || '',
            chit_scheme: data.chit_scheme || '',
            bill_amount: parseFloat(data.bill_amount || 0),
            grams:       parseFloat(data.grams       || 0),
            date: data.date || new Date().toISOString().split('T')[0],
            time: data.time || new Date().toTimeString().split(' ')[0],
            jama,
            nave,
            description: data.description || '',
            added_by: data.added_by || 'Staff',
            images: data.images || [],
            whatsapp_sent: data.whatsapp_sent || false,
            currentBalance: prevBal,
            newBalance: prevBal + delta,
            createdAt: Date.now()
        };

        setTransactions(prev => [...prev, entry]);

        let cashDelta = 0, goldDelta = 0, silverDelta = 0;

        if (entry.type === 'CASH') cashDelta = delta;
        else if (entry.type === 'GOLD') goldDelta = delta;
        else if (entry.type === 'SILVER') silverDelta = delta;

        _updateBalances(data.customerId, {
            cash: cashDelta,
            gold: goldDelta,
            silver: silverDelta,
            category: entry.category,
        });

        // Update due date if provided in transaction
        if (data.due_date) {
            updateCustomerDueDate(data.customerId, data.due_date);
        }

        // ── Sync to Supabase (fire-and-forget) ─────────────────────────────
        if (isSupabaseReady() && dbOrgId.current) {
            supabase.rpc('add_transaction', {
                p_org_id:      dbOrgId.current,
                p_customer_id: entry.cid,
                p_category:    entry.category,
                p_sub_type:    entry.sub_type,
                p_type:        entry.type,
                p_jama:        entry.jama,
                p_nave:        entry.nave,
                p_grams:       entry.grams,
                p_bill_amount: entry.bill_amount || 0,
                p_chit_scheme: entry.chit_scheme || '',
                p_description: entry.description || '',
                p_date:        entry.date,
                p_time:        entry.time,
                p_added_by:    dbUserId.current,
                p_images:      entry.images || [],
                p_current_bal: entry.currentBalance,
                p_new_bal:     entry.newBalance,
                p_due_date:    data.due_date || null,
            }).then(({ error }) => {
                if (error) console.error('[Supabase] addTransaction:', error);
            });
        }

        return entry;
    };

    const deleteTransaction = (id) => {
        const tx = transactions.find(t => t.id === id);
        if (!tx) return;

        // reverse the balance change
        const delta = tx.nave - tx.jama; // inverted
        let cashDelta = 0, goldDelta = 0, silverDelta = 0;
        if (tx.type === 'CASH') cashDelta = delta;
        else if (tx.type === 'GOLD') goldDelta = delta;
        else if (tx.type === 'SILVER') silverDelta = delta;

        _updateBalances(tx.cid, { cash: cashDelta, gold: goldDelta, silver: silverDelta, category: tx.category });

        // Keep a local copy with deletion timestamp (persists to localStorage)
        const deletedAt = new Date().toISOString();
        setDeletedTransactions(prev => [{ ...tx, deleted_at: deletedAt }, ...prev].slice(0, 200));

        setTransactions(prev => prev.filter(t => t.id !== id));

        // Soft-delete + reverse customer balance via atomic RPC
        if (dbOrgId.current) {
            supabase.rpc('delete_transaction', {
                p_transaction_id: id,
                p_deleted_at:     deletedAt,
            }).then(({ error }) => { if (error) console.error('[Supabase] deleteTransaction RPC:', error); });
        }
    };

    const seedDummyData = () => {
        const now = Date.now();
        const d   = (offset) => new Date(now + offset * 86400000).toISOString().split('T')[0];

        const day1 = d(-14); const day2 = d(-12); const day3 = d(-10);
        const day4 = d(-7);  const day5 = d(-5);  const day6 = d(-3);
        const day7 = d(-1);  const today = d(0);
        const dueOverdue  = d(-2);
        const dueUpcoming = d(5);
        const dueFuture   = d(15);

        // tx helper — curBal/newBal are the running balance for that category+type
        const tx = (id, cid, type, category, sub_type, jama, nave, curBal, newBal, date, time, desc, addedBy, ts, chit = '') => ({
            id, cid,
            type, direction: jama > 0 ? 'IN' : 'OUT',
            category, sub_type,
            metal_type: type !== 'CASH' ? type : '',
            chit_scheme: chit, bill_amount: 0,
            grams: type !== 'CASH' ? (jama > 0 ? jama : nave) : 0,
            date, time, jama, nave,
            description: desc,
            added_by: addedBy,
            images: [], whatsapp_sent: false,
            currentBalance: curBal, newBalance: newBal,
            createdAt: ts,
        });

        // ─── 15 customers covering every category / subtype / direction ────────
        // Per-category balance fields mirror the net of the transactions below.
        // Aggregate cashBalance = sum of all *Cash fields; goldBalance = retailGold+bullionGold;
        // silverBalance = bullionSilver+silverSilver  (for legacy display / export).
        const mk = (rc=0,rg=0,bc=0,bg=0,bs=0,sc=0,ss=0,cc=0) => ({
            retailCash:rc, retailGold:rg,
            bullionCash:bc, bullionGold:bg, bullionSilver:bs,
            silverCash:sc, silverSilver:ss,
            chitCash:cc,
            cashBalance: rc+bc+sc+cc,
            goldBalance: rg+bg,
            silverBalance: bs+ss,
        });

        const customers = [
            // ── Pure-category customers (1 category each) ──────────────────────
            // C1  Combo 1+2  : RETAIL CASH IN + OUT
            { id:'sd-c1',  name:'Ramesh Kumar',      mobile:'9800000001', createdAt:day1, ...mk(12000),          due_date:null,        primary_category:'CASH'   },
            // C2  Combo 3+4  : RETAIL GOLD IN + OUT
            { id:'sd-c2',  name:'Lakshmi Devi',      mobile:'9800000002', createdAt:day1, ...mk(0,15),           due_date:null,        primary_category:'GOLD'   },
            // C3  Combo 5+6  : BULLION CASH IN + OUT
            { id:'sd-c3',  name:'Suresh Bullion',    mobile:'9800000003', createdAt:day2, ...mk(0,0,20000),      due_date:null,        primary_category:'CASH'   },
            // C4  Combo 7+8  : BULLION GOLD IN + OUT
            { id:'sd-c4',  name:'Ganesh Traders',    mobile:'9800000004', createdAt:day2, ...mk(0,0,0,60),       due_date:dueOverdue,  primary_category:'GOLD'   },
            // C5  Combo 9+10 : BULLION SILVER IN + OUT
            { id:'sd-c5',  name:'Kavitha Silver',    mobile:'9800000005', createdAt:day2, ...mk(0,0,0,0,300),    due_date:null,        primary_category:'SILVER' },
            // C6  Combo 11+12: SILVER CASH IN + OUT (net negative — they owe us)
            { id:'sd-c6',  name:'Murugan Co',        mobile:'9800000006', createdAt:day3, ...mk(0,0,0,0,0,-5000),due_date:dueOverdue,  primary_category:'CASH'   },
            // C7  Combo 13+14: SILVER SILVER IN + OUT
            { id:'sd-c7',  name:'Devi Silver Works', mobile:'9800000007', createdAt:day3, ...mk(0,0,0,0,0,0,650),due_date:null,        primary_category:'SILVER' },
            // C8  Combo 15+16: CHIT CASH IN (installments) + CHIT CASH OUT (payout)
            { id:'sd-c8',  name:'Annamalai Chit',    mobile:'9800000008', createdAt:day4, ...mk(0,0,0,0,0,0,0,-15000), due_date:today, primary_category:'CASH'   },

            // ── Multi-category customers ────────────────────────────────────────
            // C9  : Retail Cash + Bullion Gold + Silver Silver (all IN)
            { id:'sd-c9',  name:'Vijay Multi',       mobile:'9800000009', createdAt:day4, ...mk(10000,0,0,50,0,0,200), due_date:dueUpcoming, primary_category:'GOLD' },
            // C10 : Retail Cash OUT + Bullion Cash IN + Chit Cash IN
            { id:'sd-c10', name:'Priya Jewellers',   mobile:'9800000010', createdAt:day4, ...mk(-12000,0,25000,0,0,0,0,3000), due_date:null, primary_category:'CASH' },
            // C11 : Retail Gold IN + Bullion Silver OUT + Silver Cash IN
            { id:'sd-c11', name:'Karthik Gold',      mobile:'9800000011', createdAt:day5, ...mk(0,30,0,0,-150,8000), due_date:dueUpcoming, primary_category:'GOLD' },
            // C12 : All DR — Bullion Gold OUT + Silver Silver OUT + Chit Cash OUT
            { id:'sd-c12', name:'Meena Metals',      mobile:'9800000012', createdAt:day5, ...mk(0,0,0,-20,0,0,-80,-2000), due_date:dueFuture, primary_category:'GOLD' },
            // C13 : Bullion Cash IN/OUT + Bullion Silver IN (bullion-only)
            { id:'sd-c13', name:'Raja Bullion',      mobile:'9800000013', createdAt:day5, ...mk(0,0,25000,0,750), due_date:null, primary_category:'CASH' },
            // C14 : Retail Cash IN/OUT + Bullion Gold IN
            { id:'sd-c14', name:'Sathya Trades',     mobile:'9800000014', createdAt:day6, ...mk(20000,0,0,15),    due_date:dueFuture, primary_category:'CASH' },
            // C15 : Chit Cash (3 installments) + Silver Cash IN
            { id:'sd-c15', name:'Nalini Chits',      mobile:'9800000015', createdAt:day6, ...mk(0,0,0,0,0,5000,0,6000), due_date:null, primary_category:'CASH' },
        ];

        // ── All 16 combinations in the transactions ────────────────────────────
        // Format: tx(id, cid, type, category, sub_type, jama, nave, curBal, newBal, date, time, desc, addedBy, ts, chitScheme)
        // Combinations:  1=RETAIL+CASH+IN  2=RETAIL+CASH+OUT  3=RETAIL+GOLD+IN  4=RETAIL+GOLD+OUT
        //                5=BULLION+CASH+IN  6=BULLION+CASH+OUT  7=BULLION+GOLD+IN  8=BULLION+GOLD+OUT
        //                9=BULLION+SILVER+IN  10=BULLION+SILVER+OUT  11=SILVER+CASH+IN  12=SILVER+CASH+OUT
        //                13=SILVER+SILVER+IN  14=SILVER+SILVER+OUT  15=CHIT+CASH+IN  16=CHIT+CASH+OUT
        const transactions = [

            // ── C1: Ramesh Kumar — RETAIL CASH (combo 1 IN, combo 2 OUT) ──────
            tx('sd-t1',  'sd-c1', 'CASH',  'RETAIL',  'CASH',    20000, 0,      0,      20000,  day3,'10:00:00','Cash deposit',            'Owner', now-10*86400000+1*3600000),
            tx('sd-t2',  'sd-c1', 'CASH',  'RETAIL',  'CASH',    0,     8000,   20000,  12000,  day7,'14:30:00','Partial withdrawal',       'Staff', now-1*86400000+5*3600000),

            // ── C2: Lakshmi Devi — RETAIL GOLD (combo 3 IN, combo 4 OUT) ──────
            // RETAIL gold → sub_type='METAL', type='GOLD'
            tx('sd-t3',  'sd-c2', 'GOLD',  'RETAIL',  'METAL',   25,    0,      0,      25,     day4,'09:30:00','Old gold deposit',        'Owner', now-7*86400000+1*3600000),
            tx('sd-t4',  'sd-c2', 'GOLD',  'RETAIL',  'METAL',   0,     10,     25,     15,     day7,'11:00:00','Gold partially given back','Owner', now-1*86400000+2*3600000),

            // ── C3: Suresh Bullion — BULLION CASH (combo 5 IN, combo 6 OUT) ───
            tx('sd-t5',  'sd-c3', 'CASH',  'BULLION', 'CASH',    50000, 0,      0,      50000,  day2,'10:00:00','Bullion payment received', 'Owner', now-12*86400000+1*3600000),
            tx('sd-t6',  'sd-c3', 'CASH',  'BULLION', 'CASH',    0,     30000,  50000,  20000,  day5,'15:00:00','Cash returned to customer','Staff', now-5*86400000+6*3600000),

            // ── C4: Ganesh Traders — BULLION GOLD (combo 7 IN, combo 8 OUT) ───
            tx('sd-t7',  'sd-c4', 'GOLD',  'BULLION', 'GOLD',    100,   0,      0,      100,    day2,'09:00:00','Bullion gold received',    'Owner', now-12*86400000+0.5*3600000),
            tx('sd-t8',  'sd-c4', 'GOLD',  'BULLION', 'GOLD',    0,     40,     100,    60,     day6,'16:00:00','Partial gold returned',    'Staff', now-3*86400000+7*3600000),

            // ── C5: Kavitha Silver — BULLION SILVER (combo 9 IN, combo 10 OUT) ─
            tx('sd-t9',  'sd-c5', 'SILVER','BULLION', 'SILVER',  500,   0,      0,      500,    day2,'11:00:00','Silver bullion deposited', 'Owner', now-12*86400000+2*3600000),
            tx('sd-t10', 'sd-c5', 'SILVER','BULLION', 'SILVER',  0,     200,    500,    300,    day6,'10:00:00','Silver returned',          'Staff', now-3*86400000+1*3600000),

            // ── C6: Murugan Co — SILVER CASH (combo 11 IN, combo 12 OUT; net DR) ─
            tx('sd-t11', 'sd-c6', 'CASH',  'SILVER',  'CASH',    15000, 0,      0,      15000,  day3,'09:00:00','Silver fund deposit',      'Staff', now-10*86400000+0.5*3600000),
            tx('sd-t12', 'sd-c6', 'CASH',  'SILVER',  'CASH',    0,     20000,  15000,  -5000,  day7,'12:00:00','Cash advance given',       'Owner', now-1*86400000+3*3600000),

            // ── C7: Devi Silver Works — SILVER SILVER (combo 13 IN, combo 14 OUT) ─
            tx('sd-t13', 'sd-c7', 'SILVER','SILVER',  'SILVER',  1000,  0,      0,      1000,   day3,'14:00:00','Silver bars received',     'Owner', now-10*86400000+5*3600000),
            tx('sd-t14', 'sd-c7', 'SILVER','SILVER',  'SILVER',  0,     350,    1000,   650,    day6,'11:30:00','Silver bars returned',     'Staff', now-3*86400000+2*3600000),

            // ── C8: Annamalai Chit — CHIT CASH (combo 15 IN×2, combo 16 OUT) ──
            tx('sd-t15', 'sd-c8', 'CASH',  'CHIT',    'CASH',    5000,  0,      0,      5000,   day4,'10:00:00','Monthly installment 1',    'Staff', now-7*86400000+1*3600000,  'MONTHLY SCHEME'),
            tx('sd-t16', 'sd-c8', 'CASH',  'CHIT',    'CASH',    5000,  0,      5000,   10000,  day5,'10:00:00','Monthly installment 2',    'Staff', now-5*86400000+1*3600000,  'MONTHLY SCHEME'),
            tx('sd-t17', 'sd-c8', 'CASH',  'CHIT',    'CASH',    0,     25000,  10000,  -15000, day7,'09:00:00','Chit payout disbursed',    'Owner', now-1*86400000+0.5*3600000,'MONTHLY SCHEME'),

            // ── C9: Vijay Multi — Retail Cash + Bullion Gold + Silver Silver ───
            tx('sd-t18', 'sd-c9', 'CASH',  'RETAIL',  'CASH',    10000, 0,      0,      10000,  day4,'11:00:00','Cash deposit',             'Owner', now-7*86400000+2*3600000),
            tx('sd-t19', 'sd-c9', 'GOLD',  'BULLION', 'GOLD',    50,    0,      0,      50,     day4,'11:30:00','Gold bullion received',    'Owner', now-7*86400000+2.5*3600000),
            tx('sd-t20', 'sd-c9', 'SILVER','SILVER',  'SILVER',  200,   0,      0,      200,    day5,'10:00:00','Silver deposit',           'Staff', now-5*86400000+1*3600000),

            // ── C10: Priya Jewellers — Retail Cash OUT + Bullion Cash + Chit ───
            tx('sd-t21', 'sd-c10','CASH',  'RETAIL',  'CASH',    0,     12000,  0,      -12000, day3,'13:00:00','Cash advance to customer', 'Owner', now-10*86400000+4*3600000),
            tx('sd-t22', 'sd-c10','CASH',  'BULLION', 'CASH',    25000, 0,      0,      25000,  day5,'09:30:00','Bullion payment received', 'Staff', now-5*86400000+0.5*3600000),
            tx('sd-t23', 'sd-c10','CASH',  'CHIT',    'CASH',    3000,  0,      0,      3000,   day7,'10:00:00','Diwali fund installment',  'Staff', now-1*86400000+1*3600000,  'DIWALI FUND'),

            // ── C11: Karthik Gold — Retail Gold IN + Bullion Silver OUT + Silver Cash IN ─
            tx('sd-t24', 'sd-c11','GOLD',  'RETAIL',  'METAL',   30,    0,      0,      30,     day4,'09:00:00','Old gold deposited',       'Owner', now-7*86400000+0.5*3600000),
            tx('sd-t25', 'sd-c11','SILVER','BULLION', 'SILVER',  0,     150,    0,      -150,   day5,'14:00:00','Silver advance given',     'Owner', now-5*86400000+5*3600000),
            tx('sd-t26', 'sd-c11','CASH',  'SILVER',  'CASH',    8000,  0,      0,      8000,   day6,'11:00:00','Silver fund payment',      'Staff', now-3*86400000+2*3600000),

            // ── C12: Meena Metals — All DR (Bullion Gold OUT + Silver Silver OUT + Chit Cash OUT) ─
            tx('sd-t27', 'sd-c12','GOLD',  'BULLION', 'GOLD',    0,     20,     0,      -20,    day5,'10:30:00','Gold advance given',       'Owner', now-5*86400000+1.5*3600000),
            tx('sd-t28', 'sd-c12','SILVER','SILVER',  'SILVER',  0,     80,     0,      -80,    day5,'11:00:00','Silver advance given',     'Owner', now-5*86400000+2*3600000),
            tx('sd-t29', 'sd-c12','CASH',  'CHIT',    'CASH',    0,     2000,   0,      -2000,  day6,'14:00:00','Gold scheme advance',      'Staff', now-3*86400000+5*3600000,  'GOLD SCHEME'),

            // ── C13: Raja Bullion — Bullion Cash IN/OUT + Bullion Silver IN ────
            tx('sd-t30', 'sd-c13','CASH',  'BULLION', 'CASH',    40000, 0,      0,      40000,  day3,'09:00:00','Bullion cash deposit',     'Owner', now-10*86400000+0.5*3600000),
            tx('sd-t31', 'sd-c13','CASH',  'BULLION', 'CASH',    0,     15000,  40000,  25000,  day6,'10:00:00','Cash returned',            'Staff', now-3*86400000+1*3600000),
            tx('sd-t32', 'sd-c13','SILVER','BULLION', 'SILVER',  750,   0,      0,      750,    day4,'15:00:00','Bulk silver bars received','Owner', now-7*86400000+6*3600000),

            // ── C14: Sathya Trades — Retail Cash IN/OUT + Bullion Gold IN ─────
            tx('sd-t33', 'sd-c14','CASH',  'RETAIL',  'CASH',    30000, 0,      0,      30000,  day2,'09:00:00','Cash deposit',             'Owner', now-12*86400000+0.5*3600000),
            tx('sd-t34', 'sd-c14','CASH',  'RETAIL',  'CASH',    0,     10000,  30000,  20000,  day5,'11:00:00','Cash withdrawal',          'Staff', now-5*86400000+2*3600000),
            tx('sd-t35', 'sd-c14','GOLD',  'BULLION', 'GOLD',    15,    0,      0,      15,     day6,'14:00:00','Gold received for trade',  'Owner', now-3*86400000+5*3600000),

            // ── C15: Nalini Chits — Chit 3 installments + Silver Cash ─────────
            tx('sd-t36', 'sd-c15','CASH',  'CHIT',    'CASH',    2000,  0,      0,      2000,   day4,'10:00:00','Silver scheme install. 1', 'Staff', now-7*86400000+1*3600000,  'SILVER SCHEME'),
            tx('sd-t37', 'sd-c15','CASH',  'CHIT',    'CASH',    2000,  0,      2000,   4000,   day5,'10:00:00','Silver scheme install. 2', 'Staff', now-5*86400000+1*3600000,  'SILVER SCHEME'),
            tx('sd-t38', 'sd-c15','CASH',  'CHIT',    'CASH',    2000,  0,      4000,   6000,   day7,'10:00:00','Silver scheme install. 3', 'Staff', now-1*86400000+1*3600000,  'SILVER SCHEME'),
            tx('sd-t39', 'sd-c15','CASH',  'SILVER',  'CASH',    5000,  0,      0,      5000,   day6,'14:00:00','Silver fund payment',      'Owner', now-3*86400000+5*3600000),
        ];

        setCustomers(customers);
        setTransactions(transactions);
        return 'Dummy data loaded — 15 customers, all 16 transaction combinations seeded!';
    };

    // ── Storage Monitoring & Cleanup ─────────────────────────────────────────
    const monitorStorage = useCallback(() => {
        try {
            let totalSize = 0;
            let supabaseKeys = 0;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    const value = localStorage.getItem(key);
                    totalSize += (key.length + (value ? value.length : 0));
                    if (key === 'oneledger-supabase-auth') supabaseKeys++;
                }
            }
            const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
            console.log(`[Storage] Using ${sizeMB}MB, ${supabaseKeys} auth keys`);
            if (parseFloat(sizeMB) > 4) {
                console.warn(`[Storage] Warning: localStorage usage is high (${sizeMB}MB). Running auth cleanup.`);
                cleanupSupabaseStorage();
            }
        } catch (err) {
            console.error('[Storage] Monitor error:', err);
        }
    }, []);

    useEffect(() => {
        monitorStorage();
        const interval = setInterval(monitorStorage, 60 * 60 * 1000); // Check every hour
        return () => clearInterval(interval);
    }, [monitorStorage]);

    const signOut = useCallback(() => {
        // Clear local state immediately — UI shows login screen right away, no freeze
        dbOrgId.current  = null;
        dbUserId.current = null;
        setOrgId(null);
        setAuthSession(null);
        // Invalidate server session in background (no await) — SIGNED_OUT event will fire
        // but state is already null so it becomes a safe no-op
        if (isSupabaseReady()) supabase.auth.signOut().catch(e => console.error('[Auth] signOut server error:', e));
    }, []);

    const value = {
        customers, transactions, deletedTransactions,
        authSession, setAuthSession,
        orgId,
        isLive,  // false = Realtime offline (show reconnecting indicator in UI)
        signOut,
        addCustomer, getCustomer, getCustomerByMobile, updateCustomer,
        addTransaction, deleteTransaction, updateCustomerDueDate,
        chitSchemes, addChitScheme, removeChitScheme,
        seedDummyData,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
