'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Lock, Mail, Loader2, AlertCircle } from 'lucide-react'
import { login as apiLogin } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const { login } = useAuth()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const response = await apiLogin({ email, password })
            login(response.token, response.user)
        } catch (err: any) {
            console.error('Login failed:', err)
            setError(err.response?.data?.message || 'Invalid email or password. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden transition-colors" style={{ backgroundColor: 'var(--bg-primary)' }}>
            {/* Background Orbs */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full blur-[120px] opacity-20" style={{ background: 'var(--accent-cyan)' }}></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full blur-[120px] opacity-20" style={{ background: 'var(--accent-purple)' }}></div>

            <div className="w-full max-w-md p-8 relative z-10">
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 cyber-glow shadow-2xl" style={{ background: 'linear-gradient(to bottom right, var(--accent-cyan), var(--accent-purple))' }}>
                        <Shield className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent" style={{ background: 'linear-gradient(to right, var(--accent-cyan), var(--accent-purple))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        RAV PLATFORM
                    </h1>
                    <p className="mt-2 text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Digital Forensics & Enterprise Security</p>
                </div>

                <div className="backdrop-blur-xl rounded-2xl p-8 border shadow-2xl transition-all" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', borderColor: 'var(--border-color)' }}>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Email Address</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border focus:outline-none transition-all text-sm"
                                    placeholder="admin@rav.local"
                                    style={{ backgroundColor: 'rgba(0,0,0,0.2)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                    onFocus={(e) => e.target.style.borderColor = 'var(--accent-cyan)'}
                                    onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border focus:outline-none transition-all text-sm"
                                    placeholder="••••••••"
                                    style={{ backgroundColor: 'rgba(0,0,0,0.2)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                    onFocus={(e) => e.target.style.borderColor = 'var(--accent-purple)'}
                                    onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center space-x-2 text-red-500 bg-red-500/10 p-3 rounded-lg border border-red-500/20 text-xs">
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 rounded-xl font-bold text-white transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cyber-glow"
                            style={{ background: 'linear-gradient(to right, var(--accent-cyan), var(--accent-purple))' }}
                        >
                            {loading ? (
                                <div className="flex items-center justify-center">
                                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                    Authenticating...
                                </div>
                            ) : (
                                'Sign In'
                            )}
                        </button>
                    </form>

                    <div className="mt-8 text-center">
                        <p className="text-xs transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                            Restricted access. Authorized personnel only.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
