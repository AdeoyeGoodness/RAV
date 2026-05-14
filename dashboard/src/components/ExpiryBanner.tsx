'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, X, Clock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getOrgDetails } from '@/lib/api'

export default function ExpiryBanner() {
  const { user, isLoading } = useAuth()
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null)
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
          const now = new Date()
          const diffMs = expiryDate.getTime() - now.getTime()
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
          setDaysRemaining(diffDays)
        }
      } catch (e) {
        console.error('Failed to fetch org expiry:', e)
      } finally {
        setLoaded(true)
      }
    }

    fetchExpiry()
  }, [user, isLoading])

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

  // Escalating urgency colors
  const bannerClasses = isExpired
    ? 'from-red-900/95 to-red-800/95 border-red-500/60'
    : isCritical
      ? 'from-red-900/90 to-red-800/90 border-red-500/50'
      : isUrgent
        ? 'from-orange-900/80 to-red-900/80 border-orange-500/40'
        : 'from-amber-900/70 to-orange-900/70 border-amber-500/30'

  const pulseClass = isExpired || isCritical ? 'animate-pulse' : ''

  const getMessage = () => {
    if (isExpired) {
      return 'Your account has expired. Contact your administrator to renew access.'
    }
    if (daysRemaining === 1) {
      return 'Your account expires tomorrow! Contact your administrator immediately to avoid service interruption.'
    }
    return `Your account expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}. Please contact your administrator to renew.`
  }

  return (
    <div
      id="expiry-banner"
      className={`
        w-full bg-gradient-to-r ${bannerClasses}
        backdrop-blur-sm border-b
        px-6 py-3
        flex items-center justify-between
        relative z-50
        transition-all duration-500 ease-out
      `}
      role="alert"
      aria-live="assertive"
    >
      {/* Animated background shimmer for critical states */}
      {(isExpired || isCritical) && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-red-500/10 to-transparent animate-shimmer" />
        </div>
      )}

      <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10">
        {/* Icon */}
        <div className={`flex-shrink-0 ${pulseClass}`}>
          {isExpired ? (
            <AlertTriangle className="w-5 h-5 text-red-300" />
          ) : (
            <Clock className="w-5 h-5 text-amber-300" />
          )}
        </div>

        {/* Message */}
        <div className="flex items-center gap-3 min-w-0">
          <span className={`
            text-xs font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full
            ${isExpired
              ? 'bg-red-500/30 text-red-200'
              : isCritical
                ? 'bg-red-500/20 text-red-300'
                : isUrgent
                  ? 'bg-orange-500/20 text-orange-300'
                  : 'bg-amber-500/20 text-amber-300'
            }
          `}>
            {isExpired ? 'EXPIRED' : isCritical ? 'CRITICAL' : isUrgent ? 'URGENT' : 'WARNING'}
          </span>
          <p className="text-sm text-white/90 font-medium truncate">
            {getMessage()}
          </p>
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 ml-4 p-1.5 rounded-lg
          hover:bg-white/10 transition-colors
          text-white/50 hover:text-white/90
          focus:outline-none focus:ring-2 focus:ring-white/20"
        aria-label="Dismiss expiry notification"
        title="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
