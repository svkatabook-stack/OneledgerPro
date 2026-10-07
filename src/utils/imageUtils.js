/**
 * imageUtils.js
 *
 * compressImage() tries to run resize + WebP encoding in a Web Worker so the
 * main thread stays responsive while the user picks photos.  On browsers that
 * don't support OffscreenCanvas (older Safari / iOS < 16.4) it falls back to
 * the original main-thread canvas path transparently.
 */

import { uploadReceipt } from '../lib/receiptImages';
import { isLocalMode } from '../lib/runtime';
import CompressWorker from '../workers/imageCompress.worker.js?worker';

const MAX_FILE_SIZE = 300 * 1024; // 300 KB

// ── Main-thread fallback (original implementation) ──────────────────────────
const compressOnMainThread = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                const MAX_DIM = 1200;
                if (width > height && width > MAX_DIM) {
                    height *= MAX_DIM / width;
                    width   = MAX_DIM;
                } else if (height > MAX_DIM) {
                    width  *= MAX_DIM / height;
                    height  = MAX_DIM;
                }

                canvas.width  = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                let quality = 0.85;
                const tryCompress = () => {
                    canvas.toBlob((blob) => {
                        if (blob.size > MAX_FILE_SIZE && quality > 0.1) {
                            quality -= 0.1;
                            tryCompress();
                        } else {
                            resolve(blob);
                        }
                    }, 'image/webp', quality);
                };
                tryCompress();
            };
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

// ── Worker path ──────────────────────────────────────────────────────────────
// Feature-detect OffscreenCanvas once at module load — avoids per-call check
const workerSupported =
    typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

const compressWithWorker = (file) =>
    new Promise((resolve, reject) => {
        // Read file as ArrayBuffer — faster to transfer to worker than DataURL
        const reader = new FileReader();
        reader.onload = (e) => {
            const buffer = e.target.result;
            let worker;
            try {
                worker = new CompressWorker();
            } catch {
                // Worker instantiation failed — fall back immediately
                return compressOnMainThread(file).then(resolve).catch(reject);
            }

            worker.onmessage = ({ data }) => {
                worker.terminate();
                if (data.ok) {
                    resolve(new Blob([data.buffer], { type: data.type }));
                } else {
                    // Worker signalled it can't handle this (e.g. convertToBlob missing)
                    compressOnMainThread(file).then(resolve).catch(reject);
                }
            };

            worker.onerror = () => {
                worker.terminate();
                compressOnMainThread(file).then(resolve).catch(reject);
            };

            worker.postMessage({ buffer, mimeType: file.type }, [buffer]);
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });

// ── Public API ───────────────────────────────────────────────────────────────
export const compressImage = (file) =>
    workerSupported ? compressWithWorker(file) : compressOnMainThread(file);

// ── Receipt upload (server-signed in cloud mode) ────────────────────────────────────────────
export const uploadToCloudinary = async (blob) => {

    // Mock upload for demo / local dev
    if (isLocalMode) {
        return new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                setTimeout(() => {
                    res({
                        id:   Math.random().toString(36).substr(2, 9),
                        url:  reader.result,
                        name: 'receipt.webp',
                        size: blob.size,
                    });
                }, 1000);
            };
            reader.onerror = rej;
            reader.readAsDataURL(blob);
        });
    }

    return uploadReceipt(blob);
};
