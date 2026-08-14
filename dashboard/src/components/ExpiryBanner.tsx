'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, X, Clock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getOrgDetails } from '@/lib/api'

// Format a positive ms duration as 'Xd HH:MM:SS' (or 'HH:MM:SS' under 24h).
// Returns '00:00:00' once the target is reached / passed.
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00'
  const totalSecs = Math.floor(ms / 1000)
  const days  = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins  = Math.floor((totalSecs % 3600) / 60)
  const secs  = totalSecs % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return days > 0
    ? `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`
    : `${pad(hours)}:${pad(mins)}:${pad(secs)}`
}

export default function ExpiryBanner() {
  const { user, isLoading } = useAuth()
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null)
  // Precise target timestamp (ms since epoch). Used to compute the HH:MM:SS countdown
  // every second, so the user sees the exact moment of expiry rather than just "2 days."
  const [expiryAt, setExpiryAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [dismissed, setDismissed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user || isLoading) return
    // Only org_admin users have org expiry — super_admins manage the platform
    if (user.role === 'super_admin') {
      setLoaded(true)
      return
    }

    const fetchExpiry = async () => {
      try {
        const org = await getOrgDetails()
        if (org.token_expiry) {
          const expiryDate = new Date(org.token_expiry)
          const diffMs = expiryDate.getTime() - Date.now()
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
          setDaysRemaining(diffDays)
          setExpiryAt(expiryDate.getTime())
        }
      } catch (e) {
        console.error('Failed to fetch org expiry:', e)
      } finally {
        setLoaded(true)
      }
    }

    fetchExpiry()
  }, [user, isLoading])

  // 1s tick for the countdown — only while the banner is actually being shown
  // (skipped for dismissed / non-eligible users / no expiry set), so we don't
  // burn a timer on every page in every role.
  useEffect(() => {
    if (dismissed || expiryAt === null || daysRemaining === null || daysRemaining > 7) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [dismissed, expiryAt, daysRemaining])

  // Don't render anything if:
  // - Still loading
  // - No expiry set
  // - More than 7 days remaining
  // - Already dismissed this session
  // - User is super_admin
  if (!loaded || daysRemaining === null || daysRemaining > 7 || dismissed || user?.role === 'super_admin') {
    return null
  }

  const isExpired = daysRemaining <= 0
  const isCritical = daysRemaining <= 2
  const isUrgent = daysRemaining <= 4

  const tone: 'crit' | 'warn' = (isExpired || isCritical) ? 'crit' : 'warn'
  const bgColor = tone === 'crit' ? 'var(--ct-crit-soft)' : 'var(--ct-warn-soft)'
  const borderColor = tone === 'crit' ? 'var(--ct-crit-border)' : 'var(--ct-warn-border)'
  const accentColor = tone === 'crit' ? 'var(--ct-crit)' : 'var(--ct-warn)'

  const msLeft = expiryAt !== null ? Math.max(0, expiryAt - now) : 0
  const countdown = formatCountdown(msLeft)

  const getMessage = () => {
    if (isExpired) {
      return 'Your account has expired. Contact your administrator to renew access.'
    }
    if (isCritical) {
      return `Your account expires in ${countdown}. Contact your administrator immediately to avoid service interruption.`
    }
    return `Your account expires in ${countdown}. Please contact your administrator to renew.`
  }

  const label = isExpired ? 'EXPIRED' : isCritical ? 'CRITICAL' : isUrgent ? 'URGENT' : 'WARNING'

  return (
    <div
      id="expiry-banner"
      className="w-full px-6 py-2.5 flex items-center justify-between relative z-50 border-b"
      style={{ background: bgColor, borderColor, color: 'var(--ct-ink)' }}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex-shrink-0" style={{ color: accentColor }}>
          {isExpired ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <Clock className="w-4 h-4" />
          )}
        </div>

        <div className="flex items-center gap-3 min-w-0">
          <span
            className="font-mono text-[10px] uppercase font-medium px-2 py-0.5 rounded-sm border"
            style={{
              color: accentColor,
              borderColor,
              background: 'transparent',
              letterSpacing: '0.18em',
            }}
          >
            {label}
          </span>
          <p className="text-[12px] font-medium truncate text-ct-ink">
            {getMessage()}
          </p>
        </div>
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 ml-4 p-1.5 rounded-sm hover:bg-ct-panel-hi transition-colors text-ct-ink3 hover:text-ct-ink focus:outline-none"
        aria-label="Dismiss expiry notification"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
