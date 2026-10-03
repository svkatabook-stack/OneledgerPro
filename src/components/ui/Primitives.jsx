import React from 'react';
import './Primitives.css';

export const Card = ({ children, className = '', ...props }) => {
    return (
        <div className={`glass-card ui-card ${className}`} {...props}>
            {children}
        </div>
    );
};

export const Button = ({ children, variant = 'primary', className = '', ...props }) => {
    return (
        <button className={`ui-button btn-${variant} ${className}`} {...props}>
            {children}
        </button>
    );
};

export const Input = ({ label, id, className = '', ...props }) => {
    return (
        <div className={`ui-input-group ${className}`}>
            {label && <label htmlFor={id} className="ui-label">{label}</label>}
            <input id={id} className="ui-input" {...props} />
        </div>
    );
};

export const Select = ({ label, id, options, className = '', ...props }) => {
    return (
        <div className={`ui-input-group ${className}`}>
            {label && <label htmlFor={id} className="ui-label">{label}</label>}
            <div className="ui-select-wrapper">
                <select id={id} className="ui-select" {...props}>
                    {options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>
        </div>
    );
};

export const Tabs = ({ tabs, activeTab, onTabChange, className = '' }) => {
    return (
        <div className={`ui-tabs ${className}`}>
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    className={`ui-tab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => onTabChange(tab.id)}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
};
