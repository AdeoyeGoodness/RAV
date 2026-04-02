'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Lock, Mail, Loader2, AlertCircle, Eye, EyeOff, Fingerprint, Scan } from 'lucide-react'
import { login as apiLogin } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

// Animated grid canvas for left panel
function CyberGrid() {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let animationId: number
        let time = 0

        const resize = () => {
            canvas.width = canvas.offsetWidth * window.devicePixelRatio
            canvas.height = canvas.offsetHeight * window.devicePixelRatio
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
        }
        resize()
        window.addEventListener('resize', resize)

        const particles: { x: number; y: number; vx: number; vy: number; size: number; opacity: number; color: string }[] = []
        for (let i = 0; i < 50; i++) {
            particles.push({
                x: Math.random() * canvas.offsetWidth,
                y: Math.random() * canvas.offsetHeight,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                size: Math.random() * 2 + 0.5,
                opacity: Math.random() * 0.5 + 0.2,
                color: Math.random() > 0.5 ? '#00D9FF' : '#6C5CE7'
            })
        }

        const draw = () => {
            const w = canvas.offsetWidth
            const h = canvas.offsetHeight
            ctx.clearRect(0, 0, w, h)
            time += 0.005

            // Draw animated grid
            const gridSize = 40
            ctx.strokeStyle = 'rgba(0, 217, 255, 0.04)'
            ctx.lineWidth = 0.5
            for (let x = 0; x <= w; x += gridSize) {
                const offset = Math.sin(time + x * 0.01) * 2
                ctx.beginPath()
                ctx.moveTo(x, 0)
                ctx.lineTo(x + offset, h)
                ctx.stroke()
            }
            for (let y = 0; y <= h; y += gridSize) {
                const offset = Math.cos(time + y * 0.01) * 2
                ctx.beginPath()
                ctx.moveTo(0, y)
                ctx.lineTo(w, y + offset)
                ctx.stroke()
            }

            // Draw and connect nearby particles
            particles.forEach((p, i) => {
                p.x += p.vx
                p.y += p.vy
                if (p.x < 0 || p.x > w) p.vx *= -1
                if (p.y < 0 || p.y > h) p.vy *= -1

                ctx.beginPath()
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
                ctx.fillStyle = p.color.replace(')', `, ${p.opacity})`).replace('rgb', 'rgba').replace('#00D9FF', 'rgba(0, 217, 255').replace('#6C5CE7', 'rgba(108, 92, 231')
                ctx.globalAlpha = p.opacity * (0.5 + Math.sin(time * 2 + i) * 0.5)
                ctx.fill()

                // Connect nearby particles
                particles.slice(i + 1).forEach(p2 => {
                    const dx = p.x - p2.x
                    const dy = p.y - p2.y
                    const dist = Math.sqrt(dx * dx + dy * dy)
                    if (dist < 120) {
                        ctx.beginPath()
                        ctx.moveTo(p.x, p.y)
                        ctx.lineTo(p2.x, p2.y)
                        ctx.strokeStyle = `rgba(0, 217, 255, ${(1 - dist / 120) * 0.15})`
                        ctx.globalAlpha = 1
                        ctx.stroke()
                    }
                })
            })
            ctx.globalAlpha = 1

            // Draw central shield glow
            const cx = w / 2
            const cy = h / 2
            const glowRadius = 100 + Math.sin(time * 1.5) * 20
            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius)
            gradient.addColorStop(0, 'rgba(0, 217, 255, 0.08)')
            gradient.addColorStop(0.5, 'rgba(108, 92, 231, 0.04)')
            gradient.addColorStop(1, 'transparent')
            ctx.fillStyle = gradient
            ctx.fillRect(0, 0, w, h)

            animationId = requestAnimationFrame(draw)
        }
        draw()

        return () => {
            cancelAnimationFrame(animationId)
            window.removeEventListener('resize', resize)
        }
    }, [])

    return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
}

// Animated scanning line
function ScanLine() {
    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div
                className="absolute left-0 right-0 h-[1px] opacity-30"
                style={{
                    background: 'linear-gradient(90deg, transparent, #00D9FF, transparent)',
                    animation: 'scanDown 4s ease-in-out infinite'
                }}
            />
            <style jsx>{`
                @keyframes scanDown {
                    0%, 100% { top: -2%; }
                    50% { top: 102%; }
                }
            `}</style>
        </div>
    )
}

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [focusedField, setFocusedField] = useState<string | null>(null)
    const [mounted, setMounted] = useState(false)
    const router = useRouter()
    const { login } = useAuth()

    useEffect(() => {
        setMounted(true)
    }, [])

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
        <div className="min-h-screen flex" style={{ backgroundColor: '#050510' }}>
            {/* ── Left Panel: Animated Visual ── */}
            <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden" style={{ backgroundColor: '#070714' }}>
                <CyberGrid />
                <ScanLine />

                {/* Gradient overlays */}
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-purple-600/5" />
                <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[#050510] to-transparent" />
                <div className="absolute top-0 left-0 right-0 h-48 bg-gradient-to-b from-[#050510]/50 to-transparent" />

                {/* Center content */}
                <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                    {/* Shield hologram */}
                    <div className="relative mb-10">
                        <div className="absolute inset-0 blur-[60px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(0,217,255,0.2), rgba(108,92,231,0.15), transparent)' }} />
                        <div className="relative w-28 h-28 flex items-center justify-center">
                            <div className="absolute inset-0 rounded-2xl border border-cyan-400/20 rotate-45" style={{ animation: 'pulse 3s ease-in-out infinite' }} />
                            <div className="absolute inset-2 rounded-2xl border border-purple-400/15 rotate-[30deg]" style={{ animation: 'pulse 3s ease-in-out infinite 0.5s' }} />
                            <div className="absolute inset-4 rounded-2xl border border-cyan-400/10 rotate-[15deg]" style={{ animation: 'pulse 3s ease-in-out infinite 1s' }} />
                            <Shield className="w-14 h-14 text-cyan-400/80" strokeWidth={1.2} />
                        </div>
                    </div>

                    <h2 className="text-4xl font-bold tracking-tight mb-3" style={{ background: 'linear-gradient(135deg, #00D9FF, #6C5CE7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        RAV PLATFORM
                    </h2>
                    <p className="text-sm tracking-[0.3em] uppercase text-slate-500 mb-10">
                        Digital Forensics & Endpoint Security
                    </p>

                    {/* Status indicators */}
                    <div className="flex gap-8 text-xs text-slate-600">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>Systems Online</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" style={{ animationDelay: '0.5s' }} />
                            <span>Encrypted</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: '1s' }} />
                            <span>Monitoring</span>
                        </div>
                    </div>
                </div>

                {/* Binary rain accents */}
                <div className="absolute top-8 left-8 text-[10px] font-mono text-cyan-900/30 leading-relaxed select-none">
                    01001010<br/>11010010<br/>00110101<br/>10101100
                </div>
                <div className="absolute bottom-8 right-8 text-[10px] font-mono text-purple-900/30 leading-relaxed select-none text-right">
                    11100011<br/>01010110<br/>10011001<br/>00101110
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
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #00D9FF, #6C5CE7)' }}>
                            <Shield className="w-7 h-7 text-white" />
                        </div>
                        <h1 className="text-2xl font-bold" style={{ background: 'linear-gradient(135deg, #00D9FF, #6C5CE7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            RAV PLATFORM
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
                        RAV v1.0 • DNEON ENTERPRISE
                    </div>
                </div>
            </div>
        </div>
    )
}
