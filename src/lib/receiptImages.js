import { supabase } from './supabase';

const cache = new Map();
export const clearReceiptCache = () => cache.clear();
async function invokeReceipt(action, body, headers) {
    const { data, error } = await supabase.functions.invoke(`receipt-images?action=${action}`, { body, headers });
    if (error || data?.error) {
        let message = data?.error;
        if (!message && error?.context?.json) {
            try { message = (await error.context.json()).error; } catch { /* generic network error */ }
        }
        throw new Error(message || 'Receipt service unavailable. Please try again.');
    }
    return data;
}
export async function uploadReceipt(blob) {
    if (blob.size > 300 * 1024) throw new Error('Photo is too large after compression. Try a smaller photo.');
    const data = await invokeReceipt('upload',blob,{'Content-Type':'image/webp'});
    if (!data?.image?.id || data.image.provider !== 'cloudinary') throw new Error('Receipt upload was not confirmed.');
    return data.image;
}
export async function resolveReceiptUrl(image, force = false) {
    if (image?.provider !== 'cloudinary') return image?.url || '';
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sign in to view this receipt.');
    const key = `${session.user.id}:${image.id}`;
    const cached = cache.get(key);
    if (!force && cached?.expiresAt > Date.now()+30000) return cached.url;
    const data = await invokeReceipt('read',{id:image.id});
    if (!data?.url?.startsWith('https://api.cloudinary.com/') || !Number.isFinite(data.expiresAt)) throw new Error('Receipt link unavailable.');
    cache.set(key,data);
    return data.url;
}
// Store asset references, never temporary viewing URLs or private signatures.
export const receiptReferences = (images = []) => images.map(image => image.provider === 'cloudinary'
    ? {id:image.id,provider:'cloudinary',format:'webp',name:'receipt.webp',size:image.size}
    : image);
