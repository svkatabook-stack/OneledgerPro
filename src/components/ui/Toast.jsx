import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import './Toast.css';

const ToastContext = createContext(null);

export const useToast = () => useContext(ToastContext);

let idCounter = 0;

const ICONS = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
};

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((message, type = 'info') => {
        const id = ++idCounter;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3500);
    }, []);

    const dismiss = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const toast = {
        success: (msg) => addToast(msg, 'success'),
        error: (msg) => addToast(msg, 'error'),
        warning: (msg) => addToast(msg, 'warning'),
        info: (msg) => addToast(msg, 'info'),
    };

    return (
        <ToastContext.Provider value={{ toast }}>
            {children}
            <div className="toast-container">
                {toasts.map(t => {
                    const Icon = ICONS[t.type];
                    return (
                        <div key={t.id} className={`toast toast-${t.type}`}>
                            <Icon size={18} className="toast-icon" />
                            <span className="toast-message">{t.message}</span>
                            <button className="toast-close" onClick={() => dismiss(t.id)}>
                                <X size={14} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
};
