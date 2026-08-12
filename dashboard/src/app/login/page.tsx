'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Shield, Lock, Mail, Loader2, AlertCircle, Eye, EyeOff, Fingerprint, Scan } from 'lucide-react'
import { login as apiLogin } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [focusedField, setFocusedField] = useState<string | null>(null)
    const [mounted, setMounted] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()
    const { login } = useAuth()

    useEffect(() => {
        setMounted(true)
        
        const errorType = searchParams.get('error')
        if (errorType === 'expired') {
            setError('Subscription Expired: Your organization\'s access period has ended. Please contact your administrator to renew.')
        } else if (errorType === 'suspended') {
            setError('Access Restricted: Your organization account has been paused or suspended. Please contact support.')
        }
    }, [searchParams])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const response = await apiLogin({ email, password })
            login(response.token, response.user)
        } catch (err: any) {
            console.error('Login failed:', err)
            const status = err.response?.status;
            
            if (status === 402) {
                setError('Subscription Expired: Your organization\'s access period has ended. Please contact your administrator to renew your forensic vault subscription.')
            } else if (status === 403) {
                setError('Access Restricted: Your organization account has been paused or suspended. Please contact DNEON Enterprise support for assistance.')
            } else {
                setError(err.response?.data?.message || 'Invalid credentials. Access to the command center denied.')
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex" style={{ backgroundColor: '#050510' }}>
            {/* ── Left Panel: Corporate ── */}
            <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden" style={{ backgroundColor: '#0B1830' }}>
                {/* Faint gridline backdrop — enterprise datasheet vibe, not cyberpunk */}
                <div
                    className="absolute inset-0 opacity-[0.045] pointer-events-none"
                    style={{
                        backgroundImage:
                            'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
                        backgroundSize: '56px 56px',
                        maskImage: 'radial-gradient(ellipse at 35% 45%, black 30%, transparent 80%)',
                        WebkitMaskImage: 'radial-gradient(ellipse at 35% 45%, black 30%, transparent 80%)',
                    }}
                />
                {/* Warm gold wash, top-left. Muted — this is a boardroom, not a nightclub. */}
                <div
                    className="absolute -top-40 -left-40 w-[560px] h-[560px] rounded-full opacity-[0.07] pointer-events-none"
                    style={{ background: 'radial-gradient(circle, #C8A253 0%, transparent 65%)' }}
                />
                {/* Cold steel wash, bottom-right */}
                <div
                    className="absolute -bottom-40 -right-40 w-[560px] h-[560px] rounded-full opacity-[0.06] pointer-events-none"
                    style={{ background: 'radial-gradient(circle, #4A88C7 0%, transparent 65%)' }}
                />

                {/* Top brand mark */}
                <div className="absolute top-10 left-12 flex items-center gap-3 z-10">
                    <div className="w-9 h-9 flex items-center justify-center rounded-md border border-white/10 bg-white/[0.02]">
                        <Shield className="w-4 h-4 text-white/80" strokeWidth={1.6} />
                    </div>
                    <span className="text-white/85 text-xs font-semibold tracking-[0.28em]">
                        RAV&nbsp;/&nbsp;SYSTEMS
                    </span>
                </div>

                {/* Centered pillar */}
                <div
                    className={`relative z-10 flex flex-col justify-center max-w-[560px] w-full mx-auto px-16 transition-all duration-700 ${
                        mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
                    }`}
                >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/40 mb-7">
                        Enterprise Digital Forensics
                    </p>
                    <h1
                        className="text-white text-[52px] leading-[1.05] font-medium tracking-tight mb-6"
                        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                    >
                        The forensic <br />
                        command centre <br />
                        for{' '}
                        <span style={{ color: '#C8A253', fontStyle: 'italic' }}>
                            modern enterprises.
                        </span>
                    </h1>
                    <p className="text-white/55 text-[15px] leading-relaxed max-w-md mb-12">
                        A single console for silent evidence collection, endpoint monitoring and
                        chain-of-custody preservation across your entire fleet.
                    </p>

                    <div className="space-y-3 border-t border-white/[0.07] pt-7">
                        {[
                            'AES-256 encryption in transit and at rest',
                            'Role-based access — Super Admin & Org Admin scopes',
                            'Chain-of-custody preserved · burn-after-reading',
                        ].map((line) => (
                            <div key={line} className="flex items-center gap-3 text-white/50 text-[13px]">
                                <div className="w-1 h-1 rounded-full bg-white/40" />
                                <span>{line}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Bottom-left footer */}
                <div className="absolute bottom-10 left-12 text-white/28 text-[11px] tracking-wide">
                    © 2026 RAV Systems · Enterprise Security Platform
                </div>

                {/* Bottom-right operational chip */}
                <div className="absolute bottom-10 right-12 flex items-center gap-2 text-white/40 text-[11px] tracking-wide">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
                    <span>Operational</span>
                </div>
            </div>

            {/* ── Right Panel: Login Form ── */}
            <div className="flex-1 flex items-center justify-center relative px-6">
                {/* Subtle background glow */}
                <div className="absolute top-[20%] right-[20%] w-[300px] h-[300px] rounded-full blur-[150px] opacity-[0.07]" style={{ background: '#00D9FF' }} />
                <div className="absolute bottom-[20%] left-[10%] w-[250px] h-[250px] rounded-full blur-[130px] opacity-[0.05]" style={{ background: '#6C5CE7' }} />

                <div className={`w-full max-w-[400px] relative z-10 transition-all duration-700 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    {/* Mobile logo (shown on small screens) */}
                    <div className="lg:hidden flex flex-col items-center mb-10">
                        <div className="w-12 h-12 rounded-md border border-white/10 bg-white/[0.02] flex items-center justify-center mb-4">
                            <Shield className="w-6 h-6 text-white/80" strokeWidth={1.6} />
                        </div>
                        <h1 className="text-xl font-semibold text-white tracking-[0.24em]">
                            RAV&nbsp;/&nbsp;SYSTEMS
                        </h1>
                    </div>

                    {/* Form header */}
                    <div className="mb-8">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/10 border border-cyan-500/20">
                                <Fingerprint className="w-4 h-4 text-cyan-400" />
                            </div>
                            <h2 className="text-xl font-semibold text-white">Welcome back</h2>
                        </div>
                        <p className="text-sm text-slate-500 ml-11">Sign in to access the command center</p>
                    </div>

                    {/* Form card */}
                    <div
                        className="rounded-2xl p-7 border backdrop-blur-xl transition-all duration-300"
                        style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            borderColor: focusedField ? 'rgba(0, 217, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                            boxShadow: focusedField
                                ? '0 0 40px rgba(0, 217, 255, 0.05), inset 0 1px 0 rgba(255,255,255,0.03)'
                                : 'inset 0 1px 0 rgba(255,255,255,0.03)'
                        }}
                    >
                        <form onSubmit={handleSubmit} className="space-y-5">
                            {/* Email */}
                            <div>
                                <label className="block text-[11px] font-medium uppercase tracking-[0.15em] mb-2 text-slate-500">
                                    Email Address
                                </label>
                                <div className="relative group">
                                    <Mail className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-200 ${focusedField === 'email' ? 'text-cyan-400' : 'text-slate-600'}`} />
                                    <input
                                        id="login-email"
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        onFocus={() => setFocusedField('email')}
                                        onBlur={() => setFocusedField(null)}
                                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm text-white placeholder-slate-600 transition-all duration-200 focus:outline-none"
                                        placeholder="admin@company.com"
                                        style={{
                                            backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                            border: `1px solid ${focusedField === 'email' ? 'rgba(0, 217, 255, 0.4)' : 'rgba(255, 255, 255, 0.06)'}`,
                                            boxShadow: focusedField === 'email' ? '0 0 20px rgba(0, 217, 255, 0.08)' : 'none'
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <label className="block text-[11px] font-medium uppercase tracking-[0.15em] mb-2 text-slate-500">
                                    Password
                                </label>
                                <div className="relative group">
                                    <Lock className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-200 ${focusedField === 'password' ? 'text-purple-400' : 'text-slate-600'}`} />
                                    <input
                                        id="login-password"
                                        type={showPassword ? 'text' : 'password'}
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onFocus={() => setFocusedField('password')}
                                        onBlur={() => setFocusedField(null)}
                                        className="w-full pl-11 pr-12 py-3 rounded-xl text-sm text-white placeholder-slate-600 transition-all duration-200 focus:outline-none"
                                        placeholder="••••••••••"
                                        style={{
                                            backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                            border: `1px solid ${focusedField === 'password' ? 'rgba(108, 92, 231, 0.4)' : 'rgba(255, 255, 255, 0.06)'}`,
                                            boxShadow: focusedField === 'password' ? '0 0 20px rgba(108, 92, 231, 0.08)' : 'none'
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="flex items-center gap-2.5 text-red-400 bg-red-500/8 p-3 rounded-xl border border-red-500/15 text-xs">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Submit */}
                            <button
                                id="login-submit"
                                type="submit"
                                disabled={loading}
                                className="w-full py-3.5 rounded-xl font-semibold text-white text-sm transition-all duration-200 transform hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none relative overflow-hidden group"
                                style={{
                                    background: 'linear-gradient(135deg, #00D9FF, #6C5CE7)',
                                    boxShadow: '0 4px 20px rgba(0, 217, 255, 0.2), 0 0 40px rgba(108, 92, 231, 0.1)'
                                }}
                            >
                                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                                {loading ? (
                                    <div className="flex items-center justify-center gap-2 relative z-10">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Authenticating...</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center gap-2 relative z-10">
                                        <Scan className="w-4 h-4" />
                                        <span>Access Command Center</span>
                                    </div>
                                )}
                            </button>
                        </form>
                    </div>

                    {/* Footer */}
                    <div className="mt-6 text-center">
                        <div className="flex items-center justify-center gap-2 text-[11px] text-slate-600">
                            <div className="w-3 h-3 rounded-full border border-slate-700 flex items-center justify-center">
                                <Lock className="w-1.5 h-1.5" />
                            </div>
                            <span>End-to-end encrypted • Restricted access</span>
                        </div>
                    </div>

                    {/* Version tag */}
                    <div className="absolute bottom-[-60px] left-1/2 -translate-x-1/2 text-[10px] text-slate-700 font-mono">
                        RAV v1.0
                    </div>
                </div>
            </div>
        </div>
    )
}
