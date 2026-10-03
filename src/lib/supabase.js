import { createClient } from '@supabase/supabase-js';
import { isLocalMode } from './runtime';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

const ready = !isLocalMode && !!supabaseUrl && !!supabaseKey && !supabaseUrl.includes('your-project-id');

if (!ready) {
    console.warn('[Supabase] No URL configured — running in localStorage-only mode');
}

// ✅ Cleanup function for old tokens
export function cleanupSupabaseStorage() {
    try {
        const now = Date.now();
        const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

        Object.keys(localStorage).forEach(key => {
            if (key === 'oneledger-supabase-auth') {
                try {
                    const value = localStorage.getItem(key);
                    if (!value) return;
                    const item = JSON.parse(value);
                    if (item.expires_at) {
                        const expiresAtMs = item.expires_at * 1000;
                        if (now - expiresAtMs > MAX_AGE) {
                            localStorage.removeItem(key);
                            console.log('[Auth] Cleaned expired token:', key);
                        }
                    } else if (item.created_at) {
                        const age = now - item.created_at;
                        if (age > MAX_AGE) {
                            localStorage.removeItem(key);
                            console.log('[Auth] Cleaned old token by created_at:', key);
                        }
                    }
                } catch (e) {
                    localStorage.removeItem(key);
                }
            }
        });
    } catch (err) {
        console.error('[Auth] Cleanup error:', err);
    }
}

// Run cleanup before creating client
if (ready && typeof window !== 'undefined' && window.localStorage) {
    cleanupSupabaseStorage();
}

export const supabase = createClient(
    ready ? supabaseUrl : 'https://placeholder.supabase.co',
    ready ? supabaseKey : 'local-placeholder',
    { auth: { persistSession: ready, autoRefreshToken: ready, detectSessionInUrl: ready, storageKey: 'oneledger-supabase-auth' } },
);

/** True when real Supabase credentials are configured */
export const isSupabaseReady = () =>
    ready;
