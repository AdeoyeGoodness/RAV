'use client'

import { useState, useEffect } from 'react'
import { CalendarClock, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getAgents } from '@/lib/api'

// Per-endpoint archive cadence — mirrors ARCHIVE_CUTOFF_DAYS /
// PER_AGENT_ARCHIVE_MIN_INTERVAL_DAYS (both 5) in backend/src/main.rs.
const ARCHIVE_CADENCE_DAYS = 5
const ARCHIVE_CADENCE_MS = ARCHIVE_CADENCE_DAYS * 24 * 60 * 60 * 1000

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

// Proactive countdown to the NEXT forensic archive. Companion to
// ArchiveBanner: where ArchiveBanner counts down to the vault sweep that
// DELETES existing archives, this counts down to the next archive being
// CREATED. "Next archive" = the soonest (last_archived_at + 5-day cadence)
// across the org's endpoints; an endpoint that was never archived is due now.
// Same visual language as ArchiveBanner, dismissable per session.
export default function NextArchiveBanner() {
  const { user, isLoading } = useAuth()
  // Wall-clock ms of the soonest upcoming archive across endpoints.
  const [nextAt, setNextAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [dismissed, setDismissed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user || isLoading) return
    // Super admins don't own a specific org's archive schedule.
    if (user.role === 'super_admin') {
      setLoaded(true)
      return
    }

    const fetchAgents = async () => {
      try {
        const agents = await getAgents()
        let soonest: number | null = null
        for (const a of agents) {
          // A device with no telemetry yet has nothing to archive. The backend
          // only snapshots endpoints that have events within the window, so a
          // freshly-enrolled, event-less device must NOT show up as an archive
          // "due now" — that's what made new devices look like they already had
          // a forensic bundle in progress.
          if (!a.latest_event_at_ms) continue
          const last = a.last_archived_at_ms ?? null
          // A never-archived endpoint that DOES have telemetry is due now.
          const due = last === null ? Date.now() : last + ARCHIVE_CADENCE_MS
          if (soonest === null || due < soonest) soonest = due
        }
        setNextAt(soonest)
      } catch (e) {
        console.error('Failed to fetch agents for next-archive banner:', e)
      } finally {
        setLoaded(true)
      }
    }

    fetchAgents()
  }, [user, isLoading])

  // 1s tick for the live countdown while the banner is shown.
  useEffect(() => {
    if (dismissed || nextAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [dismissed, nextAt])

  if (!loaded || nextAt === null || dismissed || user?.role === 'super_admin') {
    return null
  }

  const msLeft = Math.max(0, nextAt - now)
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
  const countdown = formatCountdown(msLeft)
  const isDue = msLeft <= 0
  const isSoon = daysLeft <= 1

  // Tone escalates as the next archive approaches. Normal = accent (info),
  // within a day or due = warn.
  const tone: 'warn' | 'accent' = isDue || isSoon ? 'warn' : 'accent'
  const bgColor     = tone === 'warn' ? 'var(--ct-warn-soft)'   : 'var(--ct-accent-soft)'
  const borderColor = tone === 'warn' ? 'var(--ct-warn-border)' : 'var(--ct-accent-border)'
  const accentColor = tone === 'warn' ? 'var(--ct-warn)'        : 'var(--ct-accent)'

  const message = isDue
    ? 'Forensic archive due now — the next bundle is being generated.'
    : `Next forensic archive in ${countdown}.`
  const label = isDue ? 'ARCHIVING' : 'NEXT ARCHIVE'

  return (
    <div
      id="next-archive-banner"
      className="w-full px-6 py-2.5 flex items-center justify-between relative z-50 border-b"
      style={{ background: bgColor, borderColor, color: 'var(--ct-ink)' }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex-shrink-0" style={{ color: accentColor }}>
          <CalendarClock className="w-4 h-4" />
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
            Forensic Vault
          </a>
        </div>
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 ml-4 p-1.5 rounded-sm hover:bg-ct-panel-hi transition-colors text-ct-ink3 hover:text-ct-ink focus:outline-none"
        aria-label="Dismiss next-archive notification"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
