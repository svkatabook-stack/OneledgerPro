/**
 * imageCompress.worker.js
 *
 * Runs image resize + WebP compression off the main thread using
 * createImageBitmap + OffscreenCanvas.  Falls back gracefully if either API
 * is unavailable (older Safari / iOS) by posting { ok: false } so the caller
 * can retry on the main thread.
 */

const MAX_DIM  = 1200;
const MAX_SIZE = 300 * 1024; // 300 KB

self.onmessage = async ({ data: { buffer, mimeType } }) => {
    try {
        const blob   = new Blob([buffer], { type: mimeType });
        const bitmap = await createImageBitmap(blob);

        let { width, height } = bitmap;
        if (width > height && width > MAX_DIM) {
            height = Math.round(height * MAX_DIM / width);
            width  = MAX_DIM;
        } else if (height > MAX_DIM) {
            width  = Math.round(width * MAX_DIM / height);
            height = MAX_DIM;
        }

        const canvas = new OffscreenCanvas(width, height);
        const ctx    = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        // Compress to WebP, reducing quality until under MAX_SIZE
        let quality = 0.85;
        let result;
        do {
            result  = await canvas.convertToBlob({ type: 'image/webp', quality });
            quality = parseFloat((quality - 0.1).toFixed(2));
        } while (result.size > MAX_SIZE && quality > 0.1);

        const out = await result.arrayBuffer();
        self.postMessage({ ok: true, buffer: out, type: 'image/webp' }, [out]);
    } catch (err) {
        // OffscreenCanvas / convertToBlob not supported (old Safari) — caller falls back
        self.postMessage({ ok: false, error: err.message });
    }
};
