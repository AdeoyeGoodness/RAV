'use client'

import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { formatWATTime } from '@/lib/time'
import { getServerTime } from '@/lib/api'

export default function Header() {
  const { user, isLoading } = useAuth()
  const [now, setNow] = useState<Date | null>(null)
  // ms to add to `Date.now()` to get server (VPS) wall-clock. Analysts often
  // view from laptops whose OS TZ is misconfigured (US Central instead of
  // WAT); trusting the browser clock produces a 6h off header. Sync from
  // /api/v1/time on mount + every 60s, then tick locally against the offset.
  const offsetRef = useRef<number>(0)

  useEffect(() => {
    let mounted = true

    const sync = async () => {
      try {
        const serverMs = await getServerTime()
        if (!mounted) return
        offsetRef.current = serverMs - Date.now()
        setNow(new Date(Date.now() + offsetRef.current))
      } catch {
        // On failure, fall through to browser time — better a wrong clock
        // than a blank one.
        if (mounted && offsetRef.current === 0) setNow(new Date())
      }
    }

    sync()
    const tick = setInterval(() => setNow(new Date(Date.now() + offsetRef.current)), 1000)
    const resync = setInterval(sync, 60_000)

    return () => {
      mounted = false
      clearInterval(tick)
      clearInterval(resync)
    }
  }, [])

  const displayName = user?.email?.split('@')[0] || 'Operator'
  const roleLabel =
    user?.role === 'super_admin' ? 'Super admin' : user?.role === 'org_admin' ? 'Org admin' : 'Analyst'

  return (
    <header
      className="h-20 fixed top-0 left-64 right-0 z-20 flex items-center justify-between px-8"
      style={{
        background: 'rgba(10, 11, 16, 0.85)',
        borderBottom: '1px solid var(--ct-line)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Left — page context */}
      <div className="min-w-0">
        {isLoading ? (
          <div className="h-4 w-56 rounded animate-pulse bg-ct-line" />
        ) : (
          <div className="flex items-center gap-3">
            <div
              className="font-mono text-[10px] uppercase text-ct-ink3"
              style={{ letterSpacing: '0.22em' }}
            >
              Session
            </div>
            <div className="w-[1px] h-3 bg-ct-line2" />
            <div className="font-mono text-[11px] text-ct-ink2 tabular-nums">
              {now ? formatWATTime(now) : '--:--:--'} WAT
            </div>
            <div className="w-[1px] h-3 bg-ct-line2" />
            <div className="font-mono text-[11px] text-ct-ink2 truncate">
              {displayName}
              <span className="text-ct-ink3"> · {roleLabel}</span>
            </div>
          </div>
        )}
      </div>

      {/* Center — global search */}
      <div className="flex-1 max-w-lg mx-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ct-ink3" />
          <input
            type="text"
            placeholder="Search endpoints, events, keywords, IPs…"
            className="w-full pl-9 pr-4 py-[9px] text-[12px] rounded-[3px] text-ct-ink placeholder-ct-ink3 focus:outline-none transition-colors font-mono"
            style={{
              background: 'var(--ct-panel)',
              border: '1px solid var(--ct-line)',
              letterSpacing: '0.02em',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--ct-accent-border)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--ct-line)')}
          />
        </div>
      </div>

      {/* Right — operator chip */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3">
          {isLoading ? (
            <div className="h-9 w-32 rounded animate-pulse bg-ct-line" />
          ) : (
            <>
              <div className="text-right">
                <div className="text-[12px] font-medium text-ct-ink">{displayName}</div>
                <div
                  className="font-mono text-[9px] uppercase text-ct-accent"
                  style={{ letterSpacing: '0.22em' }}
                >
                  {roleLabel}
                </div>
              </div>
              <div
                className="w-9 h-9 rounded-[3px] flex items-center justify-center font-mono text-[13px] font-semibold text-ct-accent"
                style={{ background: 'var(--ct-accent-soft)', border: '1px solid var(--ct-accent-border)' }}
              >
                {displayName.charAt(0).toUpperCase()}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
