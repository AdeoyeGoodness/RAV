'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import { StatsRow } from '@/components/dashboard/StatsRow'
import { ActivitySummary } from '@/components/dashboard/ActivitySummary'
import { KeyEvents } from '@/components/dashboard/KeyEvents'
import { EnrolledAgents } from '@/components/dashboard/EnrolledAgents'
import { UserInsights } from '@/components/dashboard/UserInsights'
import { getAgents, getEvents, Agent } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { RefreshCw } from 'lucide-react'

export default function DashboardPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [allEvents, setAllEvents] = useState<any[]>([])
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [eventStats, setEventStats] = useState({
    total: 0,
    uniqueIps: 0,
    warnings: 0,
    screenshots: 0,
    networkCount: 0,
    processCount: 0,
    fileCount: 0,
    browserCount: 0,
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0
  })

  const fetchData = useCallback(async () => {
    if (!user) return;
    setRefreshing(true)
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [agentsData, eventsData] = await Promise.all([
        getAgents(),
        getEvents({ start_time: twentyFourHoursAgo, limit: 1000 })
      ])

      setAgents(agentsData)
      setAllEvents(eventsData)

      const criticalCount = eventsData.filter((e: any) => e.severity === 'critical').length
      const highCount = eventsData.filter((e: any) => e.severity === 'high').length
      const mediumCount = eventsData.filter((e: any) => e.severity === 'medium').length
      const lowCount = eventsData.filter((e: any) => e.severity === 'low').length

      // Categories are derived server-side from event_type (backend categorize_event +
      // migration 016 backfill), so these all key off the canonical `category` field now.
      const networkCount = eventsData.filter((e: any) => e.category === 'network').length
      const processCount = eventsData.filter((e: any) => e.category === 'process').length
      const fileCount = eventsData.filter((e: any) => e.category === 'file').length
      const browserCount = eventsData.filter((e: any) => e.category === 'browser').length

      const uniqueIps = new Set(eventsData.map((e: any) => e.metadata?.remote_ip).filter(Boolean)).size
      const screenshots = eventsData.filter((e: any) => e.event_type === 'screenshot_captured').length

      setEventStats({
        total: eventsData.length,
        uniqueIps,
        warnings: mediumCount + highCount,
        screenshots,
        networkCount,
        processCount,
        fileCount,
        browserCount,
        criticalCount,
        highCount,
        mediumCount,
        lowCount
      })
      setLastRefresh(new Date())
    } catch (e) {
      console.error("Failed to fetch dashboard data:", e)
    } finally {
      setRefreshing(false)
    }
  }, [user])

  // Only fetch once when user is available — no isLoading dependency to prevent re-renders
  useEffect(() => {
    if (user && !isLoading) {
      if (user.role === 'super_admin') {
        // Soft client-side redirect (no full-page reload) so the org dashboard never paints
        router.replace('/admin')
      } else {
        fetchData()
      }
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hold the loading state for super_admins too — they belong on /admin, so never
  // render the org Command Center for them (prevents the dashboard flash on login).
  if (isLoading || !user || user.role === 'super_admin') {
    return (
      <div className="min-h-screen bg-[#030308] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-slate-800 border-t-sky-500/60 rounded-full animate-spin"></div>
          <span className="text-xs text-slate-600 font-mono tracking-wider">INITIALIZING</span>
        </div>
      </div>
    )
  }

  const isEmptyState = agents.length === 0 && eventStats.total === 0

  return (
    <div className="flex h-screen bg-[#030308] text-slate-300 font-sans overflow-hidden relative">
      {/* Ambient glow */}
      <div className="absolute top-0 left-[30%] w-[500px] h-[500px] bg-sky-500/[0.03] blur-[150px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 right-[10%] w-[400px] h-[400px] bg-indigo-500/[0.02] blur-[150px] rounded-full pointer-events-none" />

      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64 relative z-10">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />

        <main className="flex-1 overflow-auto p-8 space-y-6 mt-20 relative z-10">
          {/* Top Bar — Title + Refresh */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100 tracking-tight">Command Center</h2>
              <p className="text-xs text-slate-600 mt-0.5 font-mono">
                {lastRefresh ? `Last sync ${lastRefresh.toLocaleTimeString()}` : 'Loading telemetry...'}
              </p>
            </div>
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-sky-500/20 hover:bg-sky-500/[0.04] text-xs font-medium text-slate-400 hover:text-sky-400 transition-all disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Syncing...' : 'Refresh'}
            </button>
          </div>

          {/* Stats Overview */}
          <StatsRow stats={{
            agents: agents.length,
            events24h: eventStats.total,
            warnings: eventStats.warnings,
            uniqueIps: eventStats.uniqueIps,
            screenshots: eventStats.screenshots,
            criticalCount: eventStats.criticalCount,
            highCount: eventStats.highCount,
            mediumCount: eventStats.mediumCount,
            lowCount: eventStats.lowCount
          }} />

          {/* Getting Started — only when no data exists */}
          {isEmptyState && (
            <div className="bg-gradient-to-br from-[#0A0C18] to-[#080A14] border border-white/[0.05] rounded-2xl p-8 relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCBmaWxsPSJ1cmwoI2dyaWQpIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIi8+PC9zdmc+')] opacity-50" />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                  <h3 className="text-sm font-semibold text-slate-200">Getting Started</h3>
                </div>
                <p className="text-xs text-slate-500 mb-6 max-w-lg">Deploy the RAV agent to an endpoint to begin collecting telemetry. The dashboard will populate as data arrives.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { step: '01', title: 'Deploy Agent', desc: 'Install the RAV agent on target Windows endpoints' },
                    { step: '02', title: 'Configure Policies', desc: 'Set monitoring rules and alert thresholds' },
                    { step: '03', title: 'Monitor & Investigate', desc: 'Review events, analyze threats, export reports' },
                  ].map(({ step, title, desc }) => (
                    <div key={step} className="bg-white/[0.02] rounded-xl p-4 border border-white/[0.04] hover:border-sky-500/10 transition-all group">
                      <div className="text-[10px] font-mono text-sky-500/50 mb-2">{step}</div>
                      <p className="text-xs text-slate-300 font-medium mb-1">{title}</p>
                      <p className="text-[10px] text-slate-600 leading-relaxed">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Activity & Alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
            <ActivitySummary stats={{
              networkCount: eventStats.networkCount,
              processCount: eventStats.processCount,
              fileCount: eventStats.fileCount,
              browserCount: eventStats.browserCount
            }} />
            <KeyEvents events={allEvents.filter(e => e.severity === 'critical' || e.severity === 'high').slice(0, 6)} />
          </div>

          {/* Agents & Session */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 pb-8">
            <EnrolledAgents agents={agents} />
            <UserInsights />
          </div>
        </main>
      </div>
    </div>
  )
}
