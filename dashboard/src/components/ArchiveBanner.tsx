'use client'

import { useState, useEffect } from 'react'
import { Archive, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getArchives } from '@/lib/api'

// Mirrors the 2-day cutoff in services/archive.rs::cleanup_old_archives.
const ARCHIVE_TTL_DAYS = 2
const ARCHIVE_TTL_MS = ARCHIVE_TTL_DAYS * 24 * 60 * 60 * 1000

// Format a positive ms duration as 'Xd HH:MM:SS' (or 'HH:MM:SS' under 24h).
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

// Banner shown to org admins when there's at least one forensic archive sitting in the vault.
// Mirrors the ExpiryBanner pattern; the urgency is "you have N days to retrieve this before
// the 2-day vault sweep deletes it." Dismissable per-session.
export default function ArchiveBanner() {
  const { user, isLoading } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)
  const [daysLeft, setDaysLeft] = useState<number | null>(null)
  // Exact wall-clock moment the oldest archive will be swept (ms since epoch).
  // Drives the live HH:MM:SS countdown so admins see "47:23:18 left" instead of "2 days."
  const [deleteAt, setDeleteAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [dismissed, setDismissed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user || isLoading) return
    // Super admins don't own a specific org's vault; this banner is for the data owner.
    if (user.role === 'super_admin') {
      setLoaded(true)
      return
    }

    const fetchArchives = async () => {
      try {
        const archives = await getArchives()
        if (archives && archives.length > 0) {
          setPendingCount(archives.length)
          // Earliest-created archive = closest to its 2-day expiry.
          const oldest = archives.reduce((min, a) =>
            new Date(a.created_at) < new Date(min.created_at) ? a : min
          )
          const oldestCreatedMs = new Date(oldest.created_at).getTime()
          const ageMs = Date.now() - oldestCreatedMs
          const ageDays = ageMs / (1000 * 60 * 60 * 24)
          const remaining = Math.max(0, Math.ceil(ARCHIVE_TTL_DAYS - ageDays))
          setDaysLeft(remaining)
          setDeleteAt(oldestCreatedMs + ARCHIVE_TTL_MS)
        }
      } catch (e) {
        console.error('Failed to fetch archives for banner:', e)
      } finally {
        setLoaded(true)
      }
    }

    fetchArchives()
  }, [user, isLoading])

  // 1s tick for the countdown — only while the banner is being shown.
  useEffect(() => {
    if (dismissed || pendingCount === 0 || deleteAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [dismissed, pendingCount, deleteAt])

  if (!loaded || pendingCount === 0 || dismissed || user?.role === 'super_admin') {
    return null
  }

  const isCritical = (daysLeft ?? 3) <= 1
  const isUrgent = (daysLeft ?? 3) <= 2

  const tone: 'crit' | 'warn' | 'accent' = isCritical ? 'crit' : isUrgent ? 'warn' : 'accent'
  const bgColor =
    tone === 'crit' ? 'var(--ct-crit-soft)' :
    tone === 'warn' ? 'var(--ct-warn-soft)' :
    'var(--ct-accent-soft)'
  const borderColor =
    tone === 'crit' ? 'var(--ct-crit-border)' :
    tone === 'warn' ? 'var(--ct-warn-border)' :
    'var(--ct-accent-border)'
  const accentColor =
    tone === 'crit' ? 'var(--ct-crit)' :
    tone === 'warn' ? 'var(--ct-warn)' :
    'var(--ct-accent)'

  const msLeft = deleteAt !== null ? Math.max(0, deleteAt - now) : 0
  const countdown = formatCountdown(msLeft)

  const message = (() => {
    const archiveWord = pendingCount === 1 ? 'archive' : 'archives'
    if (msLeft <= 0) {
      return `${pendingCount} forensic ${archiveWord} — vault sweep imminent.`
    }
    if (isCritical) {
      return `${pendingCount} forensic ${archiveWord} ready — ${countdown} left before vault sweep.`
    }
    return `${pendingCount} forensic ${archiveWord} ready in the vault. ${countdown} left before automatic deletion.`
  })()

  const label = isCritical ? 'LAST CHANCE' : isUrgent ? 'EXPIRING SOON' : 'VAULT READY'

  return (
    <div
      id="archive-banner"
      className="w-full px-6 py-2.5 flex items-center justify-between relative z-50 border-b"
      style={{ background: bgColor, borderColor, color: 'var(--ct-ink)' }}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex-shrink-0" style={{ color: accentColor }}>
          <Archive className="w-4 h-4" />
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
          <p className="text-[12px] font-medium truncate text-ct-ink">{message}</p>
          <a
            href="/archives"
            className="text-[11px] font-mono uppercase underline underline-offset-2 ml-2 whitespace-nowrap"
            style={{ color: accentColor, letterSpacing: '0.18em' }}
          >
            Open Vault
          </a>
        </div>
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 ml-4 p-1.5 rounded-sm hover:bg-ct-panel-hi transition-colors text-ct-ink3 hover:text-ct-ink focus:outline-none"
        aria-label="Dismiss archive notification"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
