'use client'

import { useState, useEffect } from 'react'
import { Archive, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getArchives } from '@/lib/api'

// Mirrors the 3-day cutoff in services/archive.rs::cleanup_old_archives.
const ARCHIVE_TTL_DAYS = 3

// Banner shown to org admins when there's at least one forensic archive sitting in the vault.
// Mirrors the ExpiryBanner pattern; the urgency is "you have N days to retrieve this before
// the 3-day vault sweep deletes it." Dismissable per-session.
export default function ArchiveBanner() {
  const { user, isLoading } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)
  const [daysLeft, setDaysLeft] = useState<number | null>(null)
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
          // Earliest-created archive = closest to its 3-day expiry.
          const oldest = archives.reduce((min, a) =>
            new Date(a.created_at) < new Date(min.created_at) ? a : min
          )
          const ageMs = Date.now() - new Date(oldest.created_at).getTime()
          const ageDays = ageMs / (1000 * 60 * 60 * 24)
          const remaining = Math.max(0, Math.ceil(ARCHIVE_TTL_DAYS - ageDays))
          setDaysLeft(remaining)
        }
      } catch (e) {
        console.error('Failed to fetch archives for banner:', e)
      } finally {
        setLoaded(true)
      }
    }

    fetchArchives()
  }, [user, isLoading])

  if (!loaded || pendingCount === 0 || dismissed || user?.role === 'super_admin') {
    return null
  }

  const isCritical = (daysLeft ?? 3) <= 1
  const isUrgent = (daysLeft ?? 3) <= 2

  const bannerClasses = isCritical
    ? 'from-red-900/90 to-red-800/90 border-red-500/50'
    : isUrgent
      ? 'from-orange-900/80 to-red-900/80 border-orange-500/40'
      : 'from-sky-900/70 to-indigo-900/70 border-sky-500/30'

  const pulseClass = isCritical ? 'animate-pulse' : ''

  const message = (() => {
    const archiveWord = pendingCount === 1 ? 'archive' : 'archives'
    if (daysLeft === 0) {
      return `${pendingCount} forensic ${archiveWord} ready — last day to retrieve before vault sweep.`
    }
    if (daysLeft === 1) {
      return `${pendingCount} forensic ${archiveWord} ready — only 1 day left before vault sweep.`
    }
    return `${pendingCount} forensic ${archiveWord} ready in the vault. ${daysLeft} days left before automatic deletion.`
  })()

  return (
    <div
      id="archive-banner"
      className={`
        w-full bg-gradient-to-r ${bannerClasses}
        backdrop-blur-sm border-b
        px-6 py-3
        flex items-center justify-between
        relative z-50
        transition-all duration-500 ease-out
      `}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10">
        <div className={`flex-shrink-0 ${pulseClass}`}>
          <Archive className={`w-5 h-5 ${isCritical ? 'text-red-300' : isUrgent ? 'text-orange-300' : 'text-sky-300'}`} />
        </div>

        <div className="flex items-center gap-3 min-w-0">
          <span className={`
            text-xs font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full
            ${isCritical
              ? 'bg-red-500/20 text-red-300'
              : isUrgent
                ? 'bg-orange-500/20 text-orange-300'
                : 'bg-sky-500/20 text-sky-300'
            }
          `}>
            {isCritical ? 'LAST CHANCE' : isUrgent ? 'EXPIRING SOON' : 'VAULT READY'}
          </span>
          <p className="text-sm text-white/90 font-medium truncate">
            {message}
          </p>
          <a
            href="/archives"
            className="text-xs text-white/80 hover:text-white underline underline-offset-2 ml-2 whitespace-nowrap"
          >
            Open Vault →
          </a>
        </div>
      </div>

      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 ml-4 p-1.5 rounded-lg
          hover:bg-white/10 transition-colors
          text-white/50 hover:text-white/90
          focus:outline-none focus:ring-2 focus:ring-white/20"
        aria-label="Dismiss archive notification"
        title="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
