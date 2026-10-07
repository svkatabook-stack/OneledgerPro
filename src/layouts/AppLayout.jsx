import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, User, Settings, Menu, X, Activity, LogOut, BookOpen, PlusCircle } from 'lucide-react';
import { useAppContext } from '../context/appState';
import './AppLayout.css';
import { isLocalMode } from '../lib/runtime';

const AppLayout = () => {
    const location = useLocation();
    const { authSession, signOut, syncError, isOnline, isLive, lastSyncedAt, refresh } = useAppContext();
    const [isMenuOpen,    setIsMenuOpen]    = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);

    const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

    const roleName = authSession?.role === 'super-admin' ? 'Super Admin'
        : authSession?.role === 'owner' ? 'Owner'
        : authSession?.role === 'staff' ? 'Staff'
        : authSession?.role === 'view' ? 'View Only'
        : 'Unknown';

    const handleSignOut = async () => {
        setIsProfileOpen(false);
        setIsMenuOpen(false);
        await signOut();
    };

    return (
        <div className="app-container">
            {/* Top Header */}
            <header className="glass-panel app-header">
                <div className="header-left">
                    <Menu className="header-icon" size={24} onClick={toggleMenu} />
                    <Link to="/" style={{ textDecoration: 'none' }}>
                        <h1 className="header-title">OneLedger Pro</h1>
                        {isLocalMode && <span style={{ fontSize: '0.65rem', color: '#a5b4fc' }}>LOCAL DEMO</span>}
                    </Link>
                </div>
                <div className="header-right" style={{ position: 'relative' }}>
                    <div
                        className="user-avatar"
                        onClick={() => setIsProfileOpen(!isProfileOpen)}
                    >
                        <User size={20} />
                    </div>
                    {isProfileOpen && (
                        <div className="profile-dropdown glass-panel" style={{
                            position: 'absolute',
                            top: '50px',
                            right: '0',
                            minWidth: '180px',
                            padding: '0.75rem',
                            borderRadius: '12px',
                            zIndex: 200,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem',
                            animation: 'fadeIn 0.2s ease-out'
                        }}>
                            <div style={{
                                padding: '0.5rem 0.75rem',
                                borderBottom: '1px solid rgba(255,255,255,0.08)',
                                marginBottom: '0.25rem'
                            }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Signed in as</div>
                                <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--accent-blue)', marginTop: '2px' }}>{roleName}</div>
                            </div>
                            <button
                                onClick={handleSignOut}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.6rem 0.75rem',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    borderRadius: '8px',
                                    color: '#ef4444',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem',
                                    fontWeight: 500,
                                    transition: 'all 0.2s'
                                }}
                            >
                                <LogOut size={16} /> Sign Out
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {/* Sidebar Menu Overlay */}
            {isMenuOpen && (
                <div className="sidebar-overlay" onClick={toggleMenu}>
                    <div className="sidebar-menu glass-panel" onClick={e => e.stopPropagation()}>
                        <div className="sidebar-header">
                            <h2>Menu</h2>
                            <X className="header-icon" size={24} onClick={toggleMenu} />
                        </div>
                        <div style={{ padding: '0.75rem 1rem', background: 'rgba(99,102,241,0.08)', borderRadius: '10px', marginBottom: '1rem', border: '1px solid rgba(99,102,241,0.2)' }}>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Signed in as</div>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#a5b4fc', marginTop: '3px' }}>{roleName}</div>
                        </div>

                        {/* Nav links */}
                        {[
                            { to: '/',            icon: <Home size={18} />,      label: 'Home' },
                            { to: '/customers',   icon: <User size={18} />,      label: 'Customers' },
                            { to: '/transactions',icon: <PlusCircle size={18} />,label: 'Add Transaction' },
                            { to: '/ledger',      icon: <BookOpen size={18} />,  label: 'Ledger' },
                            { to: '/due',         icon: <Activity size={18} />,  label: 'Dues' },
                            { to: '/settings',    icon: <Settings size={18} />,  label: 'Settings' },
                        ].map(({ to, icon, label }) => (
                            <Link
                                key={to}
                                to={to}
                                onClick={toggleMenu}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                                    padding: '0.7rem 1rem', borderRadius: '10px',
                                    color: location.pathname === to || (to !== '/' && location.pathname.startsWith(to))
                                        ? '#a5b4fc' : 'var(--text-secondary)',
                                    background: location.pathname === to || (to !== '/' && location.pathname.startsWith(to))
                                        ? 'rgba(99,102,241,0.12)' : 'transparent',
                                    textDecoration: 'none', fontSize: '0.92rem', fontWeight: 600,
                                    transition: 'all 0.15s',
                                }}
                            >
                                {icon} {label}
                            </Link>
                        ))}

                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
                        <button
                            onClick={handleSignOut}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.6rem',
                                padding: '0.75rem 1rem', width: '100%',
                                background: 'rgba(244, 63, 94, 0.08)',
                                border: '1px solid rgba(244, 63, 94, 0.2)',
                                borderRadius: '10px', color: '#f43f5e',
                                cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
                                fontFamily: 'var(--font-main)', transition: 'all 0.2s'
                            }}
                        >
                            <LogOut size={18} /> Sign Out
                        </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <main className="app-main">
                <div className="content-container animate-fade-in">
                    {!isLocalMode && <div role="status" style={{padding:8,fontSize:'0.8rem',color:'var(--text-muted)'}}>
                        {!isOnline ? 'Offline — reconnect before saving. Your open form is kept in this tab.' : syncError ? 'Refresh failed — showing last loaded data.' : lastSyncedAt ? (isLive ? 'Connected' : 'Connected — periodic refresh') : 'Loading cloud data…'}
                        {isOnline && <button type="button" onClick={refresh} style={{marginLeft:8}}>Refresh data</button>}
                    </div>}
                    {syncError && <div role="alert" style={{ padding: 12, color: '#fca5a5' }}>Cloud refresh failed: {syncError}. Showing the last loaded data.</div>}
                    <Outlet />
                </div>
            </main>

            {/* Bottom Navigation */}
            <nav className="glass-panel app-bottom-nav">
                <Link
                    to="/"
                    className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}
                >
                    <Home size={20} />
                    <span>Home</span>
                </Link>
                <Link
                    to="/customers"
                    className={`nav-item ${location.pathname.startsWith('/customers') ? 'active' : ''}`}
                >
                    <User size={20} />
                    <span>Customers</span>
                </Link>
                <Link
                    to="/transactions"
                    className={`nav-item ${location.pathname === '/transactions' ? 'active' : ''}`}
                >
                    <PlusCircle size={20} />
                    <span>Transactions</span>
                </Link>
                <Link
                    to="/ledger"
                    className={`nav-item ${location.pathname === '/ledger' ? 'active' : ''}`}
                >
                    <BookOpen size={20} />
                    <span>Ledger</span>
                </Link>
                <Link
                    to="/due"
                    className={`nav-item ${location.pathname === '/due' ? 'active' : ''}`}
                >
                    <Activity size={20} />
                    <span>Dues</span>
                </Link>
                <Link
                    to="/settings"
                    className={`nav-item ${location.pathname === '/settings' ? 'active' : ''}`}
                >
                    <Settings size={20} />
                    <span>Settings</span>
                </Link>
            </nav>
        </div>
    );
};

export default AppLayout;
