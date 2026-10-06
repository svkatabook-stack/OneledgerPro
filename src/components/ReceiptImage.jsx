import React, { useEffect, useState } from 'react';
import { resolveReceiptUrl } from '../lib/receiptImages';

export default function ReceiptImage(props) {
    const image = props.image || {};
    return <ReceiptImageContent key={`${image.provider}:${image.id}:${image.url}`} {...props} />;
}

function ReceiptImageContent({ image, alt = 'Receipt', style, onClick }) {
    const { id, url: legacyUrl, provider } = image || {};
    const [url,setUrl] = useState('');
    const [error,setError] = useState('');
    const [retry,setRetry] = useState(0);
    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const next = await resolveReceiptUrl({ id, url: legacyUrl, provider }, retry > 0);
                if (active) { setUrl(next); setError(''); }
            } catch (err) { if (active) { setUrl(''); setError(err.message); } }
        };
        load();
        const timer = provider === 'cloudinary' ? setInterval(load,240000) : null;
        return () => { active = false; if (timer) clearInterval(timer); };
    },[id,legacyUrl,provider,retry]);
    if (error) return <span role="status" style={{fontSize:'0.8rem'}}>{error} <button type="button" onClick={e=>{e.stopPropagation();setRetry(v=>v+1);}}>Retry photo</button></span>;
    if (!url) return <span style={{fontSize:'0.8rem'}}>Loading receipt…</span>;
    return <img src={url} alt={alt} style={style} onClick={onClick} onError={()=>{setError('Receipt could not be loaded.');setUrl('');}} />;
}
