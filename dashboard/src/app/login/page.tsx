'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Lock, Mail, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { login as apiLogin } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const searchParams = useSearchParams()
  const { login } = useAuth()

  useEffect(() => {
    setMounted(true)
    const errorType = searchParams.get('error')
    if (errorType === 'expired') {
      setError("Subscription expired: your organisation's access period has ended. Please contact your administrator to renew.")
    } else if (errorType === 'suspended') {
      setError('Access restricted: your organisation account has been paused or suspended. Please contact support.')
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
      const status = err.response?.status
      if (status === 402) {
        setError("Subscription expired: your organisation's access period has ended. Please contact your administrator to renew.")
      } else if (status === 403) {
        setError('Access restricted: your organisation account has been paused or suspended. Please contact support.')
      } else {
        setError(err.response?.data?.message || 'Invalid credentials. Access denied.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#0B1830' }}>
      {/* Left · thesis */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        {/* Faint grid — enterprise datasheet vibe, not cyberpunk */}
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
        <div
          className="absolute -top-40 -left-40 w-[560px] h-[560px] rounded-full opacity-[0.07] pointer-events-none"
          style={{ background: 'radial-gradient(circle, #C8A253 0%, transparent 65%)' }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-[560px] h-[560px] rounded-full opacity-[0.06] pointer-events-none"
          style={{ background: 'radial-gradient(circle, #4A88C7 0%, transparent 65%)' }}
        />

        {/* Brand */}
        <div className="absolute top-10 left-12 flex items-center gap-3 z-10">
          <div
            className="w-[14px] h-[14px] rounded-sm"
            style={{ background: '#5B7CF7', boxShadow: '0 0 0 4px rgba(91,124,247,0.15)' }}
          />
          <span
            className="text-white/85 text-[12px] font-semibold font-mono"
            style={{ letterSpacing: '0.32em' }}
          >
            RAV&nbsp;/&nbsp;SYSTEMS
          </span>
        </div>

        {/* Thesis */}
        <div
          className={`relative z-10 flex flex-col justify-center max-w-[560px] w-full mx-auto px-16 transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          <div
            className="text-white/40 text-[11px] font-mono font-medium uppercase mb-7 flex items-center gap-4"
            style={{ letterSpacing: '0.32em' }}
          >
            <span className="inline-block w-7 h-[1px] bg-[#C8A253]" />
            Enterprise digital forensics
          </div>
          <h1
            className="text-white text-[52px] leading-[1.05] font-medium tracking-tight mb-6"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            The forensic <br />
            command centre <br />
            for{' '}
            <span style={{ color: '#C8A253', fontStyle: 'italic' }}>modern enterprises.</span>
          </h1>
          <p className="text-white/55 text-[15px] leading-relaxed max-w-md mb-12">
            A single console for silent evidence collection, endpoint monitoring, and
            chain-of-custody preservation — commissioned inside your infrastructure, never anyone
            else&apos;s.
          </p>

          <div className="space-y-3 border-t border-white/[0.07] pt-7">
            {[
              'AES-256 encryption · in transit and at rest',
              'Role-based access · Super admin & Org admin scopes',
              'Chain-of-custody preserved · burn-after-reading vault',
            ].map((line) => (
              <div key={line} className="flex items-center gap-3 text-white/50 text-[13px]">
                <div className="w-1 h-1 rounded-full bg-white/40" />
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="absolute bottom-10 left-12 text-white/28 text-[11px]"
          style={{ letterSpacing: '0.06em' }}
        >
          © 2026 RAV Systems · Enterprise Security Platform
        </div>
        <div
          className="absolute bottom-10 right-12 flex items-center gap-2 text-white/40 text-[11px] font-mono uppercase"
          style={{ letterSpacing: '0.18em' }}
        >
          <div className="w-[6px] h-[6px] rounded-full bg-emerald-400/70" />
          <span>Operational</span>
        </div>
      </div>

      {/* Right · form */}
      <div className="flex-1 flex items-center justify-center relative px-6">
        <div
          className={`w-full max-w-[420px] relative z-10 transition-all duration-700 delay-200 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          {/* Mobile brand */}
          <div className="lg:hidden flex flex-col items-center mb-8 gap-3">
            <div
              className="w-[14px] h-[14px] rounded-sm"
              style={{ background: '#5B7CF7', boxShadow: '0 0 0 4px rgba(91,124,247,0.15)' }}
            />
            <span
              className="text-white/85 text-[12px] font-semibold font-mono"
              style={{ letterSpacing: '0.32em' }}
            >
              RAV&nbsp;/&nbsp;SYSTEMS
            </span>
          </div>

          {/* Header */}
          <div
            className="text-white/45 text-[10px] font-mono uppercase mb-3 flex items-center gap-3"
            style={{ letterSpacing: '0.28em' }}
          >
            <span className="inline-block w-4 h-[1px] bg-white/20" />
            Restricted access
            <span className="inline-block w-4 h-[1px] bg-white/20" />
          </div>
          <h2 className="text-white text-[30px] font-semibold mb-2" style={{ letterSpacing: '-0.01em' }}>
            Welcome back.
          </h2>
          <p className="text-white/55 text-[15px] mb-8">
            Sign in to your organisation&apos;s console.
          </p>

          {/* Form card */}
          <div
            className="rounded-[3px] p-7"
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
          >
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label
                  className="block text-[10px] font-mono font-medium uppercase mb-2 text-white/45"
                  style={{ letterSpacing: '0.22em' }}
                >
                  Work email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 text-[14px] text-white placeholder-white/30 focus:outline-none rounded-sm transition-colors"
                    placeholder="you@company.com"
                    style={{
                      background: 'rgba(0, 0, 0, 0.30)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(91,124,247,0.35)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label
                  className="block text-[10px] font-mono font-medium uppercase mb-2 text-white/45"
                  style={{ letterSpacing: '0.22em' }}
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-11 pr-11 py-3 text-[14px] text-white placeholder-white/30 focus:outline-none rounded-sm transition-colors"
                    placeholder="••••••••••"
                    style={{
                      background: 'rgba(0, 0, 0, 0.30)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(91,124,247,0.35)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div
                  className="flex items-start gap-2.5 p-3 rounded-sm text-[12px]"
                  style={{
                    background: 'rgba(232, 104, 104, 0.10)',
                    border: '1px solid rgba(232, 104, 104, 0.30)',
                    color: '#F0A0A0',
                  }}
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button
                id="login-submit"
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-sm text-white text-[14px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: '#5B7CF7',
                  boxShadow: '0 12px 34px rgba(91,124,247,0.30)',
                  letterSpacing: '0.01em',
                }}
                onMouseEnter={(e) => !loading && (e.currentTarget.style.filter = 'brightness(1.1)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = 'brightness(1)')}
              >
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Authenticating…</span>
                  </div>
                ) : (
                  <span>Access Command Centre</span>
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="mt-6 flex items-center justify-center gap-2 text-white/40 text-[11px] font-mono uppercase" style={{ letterSpacing: '0.20em' }}>
            <Lock className="w-3 h-3" />
            <span>End-to-end encrypted</span>
            <span className="text-white/20">·</span>
            <span>RAV v1.0</span>
          </div>
        </div>
      </div>
    </div>
  )
}
