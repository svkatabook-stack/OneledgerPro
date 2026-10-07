import React, { useState, useEffect } from 'react';
import { Lock, UserCheck, Eye, EyeOff, Loader, ArrowLeft } from 'lucide-react';
import { useAppContext } from '../context/appState';
import { supabase, isSupabaseReady } from '../lib/supabase';
import { isLocalMode, LOCAL_PASSCODES } from '../lib/runtime';
import { ROLE_EMAILS } from '../lib/roleAuth';
import './Login.css';

const ROLE_CONFIG = {
    owner: { label: 'Owner', icon: '👑', accent: 'gold',  title: 'Owner Sign In' },
    staff: { label: 'Staff', icon: '👤', accent: 'blue',  title: 'Staff Sign In' },
    view:  { label: 'View',  icon: '👁', accent: 'muted', title: 'View Access'   },
};

const Login = () => {
    const { setAuthSession, authError } = useAppContext();
    const [selectedRole, setSelectedRole] = useState(null);
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [devMode, setDevMode] = useState(false);
    useEffect(() => {
        const checkHash = () => setDevMode(isLocalMode && window.location.hash === '#devmode');
        checkHash();
        window.addEventListener('hashchange', checkHash);
        return () => window.removeEventListener('hashchange', checkHash);
    }, []);

    const handleRoleSelect = (role) => {
        setSelectedRole(role);
        setError('');
        setPassword('');
    };

    const handleBack = () => {
        setSelectedRole(null);
        setError('');
        setPassword('');
        setLoading(false);
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            // Dev/super-admin shortcut
            if (isLocalMode && devMode && password === 'admin') {
                setAuthSession({ role: 'super-admin' });
                return;
            }

            if (!isLocalMode) {
                if (!isSupabaseReady()) throw new Error('Cloud connection is not configured.');
                const { error } = await supabase.auth.signInWithPassword({ email: ROLE_EMAILS[selectedRole], password });
                if (error) throw error;
                return;
            }

            // Local mode keeps all ledger data in this browser.
            if (!isLocalMode) {
                setError('Cloud setup is incomplete. Switch to local mode to continue.');
                return;
            }
            if (LOCAL_PASSCODES[selectedRole] === password) setAuthSession({ role: selectedRole });
            else setError('Invalid passcode.');

        } catch (err) {
            console.error(err);
            setError('Login error: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const roleConfig = selectedRole ? ROLE_CONFIG[selectedRole] : null;

    return (
        <div className="login-container">
            <div className="login-card glass-panel animate-fade-in">
                {/* Header */}
                <div className="login-header">
                    <div className="login-icon-wrap">
                        <Lock size={32} className="text-blue" />
                    </div>
                    <h2>OneLedger Pro</h2>
                    <p>Cash, gold, silver &amp; chit ledger</p>
                    {isLocalMode && <p style={{ marginTop: 12, fontSize: '0.8rem', color: '#a5b4fc' }}>Local demo · Data stays in this browser</p>}
                </div>

                {isLocalMode && <div style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    Demo passcodes: <strong>owner-local</strong>, <strong>staff-local</strong>, <strong>view-local</strong>
                </div>}
                {authError && <div className="login-error" role="alert">{authError}</div>}
                {/* Step 1: Role selector */}
                {!selectedRole && (
                    <div>
                        <p className="login-step-label">Select your role to continue</p>
                        <div className="role-grid">
                            {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
                                <button
                                    key={role}
                                    className={`role-tile role-tile-${cfg.accent}`}
                                    onClick={() => handleRoleSelect(role)}
                                    type="button"
                                >
                                    <span className="role-tile-icon">{cfg.icon}</span>
                                    <span className="role-tile-label">{cfg.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 2: Passcode input */}
                {selectedRole && (
                    <div>
                        <div className="login-step-header">
                            {<button className="login-back-btn" onClick={handleBack} type="button">
                                <ArrowLeft size={18} />
                            </button>}
                            <span className="login-step-title">{roleConfig.title}</span>
                        </div>

                        <form onSubmit={handleLogin} className="login-form">
                            <div className="input-group" style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder={isLocalMode ? 'Enter Passcode...' : 'Password'}
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoFocus
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: 'absolute', right: '12px', top: '50%',
                                        transform: 'translateY(-50%)', background: 'none',
                                        border: 'none', color: 'var(--text-muted)',
                                        cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center',
                                    }}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {error && <div className="login-error" role="alert">{error}</div>}

                            <button type="submit" className="login-btn" disabled={loading || !password}>
                                {loading
                                    ? <><Loader size={18} className="spin" /> Signing in…</>
                                    : <><UserCheck size={18} /> Sign In</>
                                }
                            </button>
                        </form>

                        <p className="login-footer-hint">{isLocalMode ? 'Local demo access' : 'Enter the password provided by your owner.'}</p>
                    </div>
                )}

                {devMode && (
                    <div className="dev-banner">Super Admin Mode Active (Pass: admin)</div>
                )}
            </div>
        </div>
    );
};

export default Login;
