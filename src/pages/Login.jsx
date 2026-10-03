import React, { useState, useEffect } from 'react';
import { Lock, UserCheck, Eye, EyeOff, Loader, ArrowLeft } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { supabase, isSupabaseReady } from '../lib/supabase';
import { isLocalMode, LOCAL_PASSCODES } from '../lib/runtime';
import './Login.css';

// Local demo access is separate from cloud authentication.
// Cloud role accounts will be configured with the new Supabase project.
const FALLBACK_HASHES = {};

const ROLE_CONFIG = {
    owner: { label: 'Owner', icon: '👑', accent: 'gold',  title: 'Owner Sign In' },
    staff: { label: 'Staff', icon: '👤', accent: 'blue',  title: 'Staff Sign In' },
    view:  { label: 'View',  icon: '👁', accent: 'muted', title: 'View Access'   },
};

const hashPassword = async (text) => {
    const msgUint8 = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const Login = () => {
    const { setAuthSession } = useAppContext();
    const [selectedRole, setSelectedRole] = useState(null);
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [devMode, setDevMode] = useState(false);
    const [orgHashes, setOrgHashes] = useState(null);

    useEffect(() => {
        const checkHash = () => setDevMode(window.location.hash === '#devmode');
        checkHash();
        window.addEventListener('hashchange', checkHash);
        return () => window.removeEventListener('hashchange', checkHash);
    }, []);

    // Fetch org passcode hashes (anon access — works before login)
    useEffect(() => {
        if (!isSupabaseReady()) return;
        supabase
            .from('organizations')
            .select('passcode_owner_hash, passcode_staff_hash, passcode_view_hash')
            .single()
            .then(({ data }) => { if (data) setOrgHashes(data); });
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
        // Track whether Supabase auth was dispatched — in that case we leave the
        // spinner running until onAuthStateChange fires and unmounts this component.
        const supabaseAuthDispatched = false;

        try {
            // Dev/super-admin shortcut
            if (isLocalMode && devMode && password === 'admin') {
                setAuthSession({ role: 'super-admin' });
                return;
            }

            // ── Path 1: Supabase Auth with hash verification ──────────────────
            if (isSupabaseReady()) {
                if (window.crypto?.subtle) {
                    const hashed = await hashPassword(password);
                    const expectedHash = orgHashes?.[`passcode_${selectedRole}_hash`] || FALLBACK_HASHES[selectedRole];
                    if (hashed !== expectedHash) {
                        setError('Invalid passcode.');
                        return;
                    }
                }

                setError('Cloud sign-in setup is pending. Use local mode for now.');
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
            if (!supabaseAuthDispatched) setLoading(false);
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
                            <button className="login-back-btn" onClick={handleBack} type="button">
                                <ArrowLeft size={18} />
                            </button>
                            <span className="login-step-title">{roleConfig.title}</span>
                        </div>

                        <form onSubmit={handleLogin} className="login-form">
                            <div className="input-group" style={{ position: 'relative' }}>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Enter Passcode..."
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
                            {error && <div className="login-error">{error}</div>}

                            <button type="submit" className="login-btn" disabled={loading || !password}>
                                {loading
                                    ? <><Loader size={18} className="spin" /> Signing in…</>
                                    : <><UserCheck size={18} /> Sign In</>
                                }
                            </button>
                        </form>

                        <p className="login-footer-hint">Contact your administrator for your access code</p>
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
