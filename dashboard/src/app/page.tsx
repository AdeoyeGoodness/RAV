'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { StatsRow } from '@/components/dashboard/StatsRow'
import { ActivitySummary } from '@/components/dashboard/ActivitySummary'
import { KeyEvents } from '@/components/dashboard/KeyEvents'
import { EnrolledAgents } from '@/components/dashboard/EnrolledAgents'
import { UserInsights } from '@/components/dashboard/UserInsights'
import { getAgents, getEvents, Agent } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

export default function DashboardPage() {
  const { user, isLoading } = useAuth()
  const [agents, setAgents] = useState<Agent[]>([])
  const [allEvents, setAllEvents] = useState<any[]>([])
  const [eventStats, setEventStats] = useState({
    total: 0,
    uniqueIps: 0,
    warnings: 0,
    screenshots: 0,
    // Category counts for ActivitySummary
    networkCount: 0,
    processCount: 0,
    fileCount: 0,
    browserCount: 0,
    // Severity breakdown for StatsRow
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0
  })

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        const [agentsData, eventsData] = await Promise.all([
          getAgents(),
          getEvents({ limit: 500 }) // Fetch enough to calculate basic stats
        ])

        setAgents(agentsData)
        setAllEvents(eventsData)

        // Calculate stats
        const criticalCount = eventsData.filter(e => e.severity === 'critical').length
        const highCount = eventsData.filter(e => e.severity === 'high').length
        const mediumCount = eventsData.filter(e => e.severity === 'medium').length
        const lowCount = eventsData.filter(e => e.severity === 'low').length

        const networkCount = eventsData.filter(e => e.category === 'network').length
        const processCount = eventsData.filter(e => e.category === 'process').length
        const fileCount = eventsData.filter(e => e.category === 'file').length
        const browserCount = eventsData.filter(e => e.event_type?.includes('BROWSER') || e.event_type?.includes('URL')).length

        const uniqueIps = new Set(eventsData.map(e => e.metadata?.remote_ip).filter(Boolean)).size
        const screenshots = eventsData.filter(e => e.event_type === 'SCREENSHOT_TAKEN').length

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

      } catch (e) {
        console.error("Failed to fetch dashboard data:", e)
      }
    }
    fetchData()
  }, [user, isLoading])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-[#05050A] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-slate-700 border-t-slate-400 rounded-full animate-spin"></div>
        </div>
      </div>
    )
  }

  const isEmptyState = agents.length === 0 && eventStats.total === 0

  return (
    <div className="flex h-screen bg-[#050510] text-slate-300 font-sans selection:bg-sky-500/20 overflow-hidden relative">
      {/* Subtle ambient gradients — barely visible */}
      <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[40%] bg-sky-900/10 blur-[180px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-violet-900/8 blur-[180px] rounded-full pointer-events-none" />

      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64 relative z-10">
        <Header />

        <main className="flex-1 overflow-auto p-6 space-y-5 mt-20 relative z-10 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
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
            <div className="bg-[#0C0E1C]/90 border border-white/[0.06] rounded-2xl p-6 shadow-xl">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-sky-500/8 border border-sky-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-5 h-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-slate-200 mb-1">Getting Started</h3>
                  <p className="text-xs text-slate-500 mb-4">Deploy the RAV agent to an endpoint to begin collecting telemetry. The dashboard will populate as data arrives.</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-[#080A14]/60 rounded-xl p-3.5 border border-white/[0.04]">
                      <div className="text-[10px] font-mono text-sky-500/60 mb-1.5">01</div>
                      <p className="text-xs text-slate-400 font-medium mb-0.5">Deploy Agent</p>
                      <p className="text-[10px] text-slate-600">Install the RAV agent on target Windows endpoints</p>
                    </div>
                    <div className="bg-[#080A14]/60 rounded-xl p-3.5 border border-white/[0.04]">
                      <div className="text-[10px] font-mono text-sky-500/60 mb-1.5">02</div>
                      <p className="text-xs text-slate-400 font-medium mb-0.5">Configure Policies</p>
                      <p className="text-[10px] text-slate-600">Set monitoring rules and alert thresholds</p>
                    </div>
                    <div className="bg-[#080A14]/60 rounded-xl p-3.5 border border-white/[0.04]">
                      <div className="text-[10px] font-mono text-sky-500/60 mb-1.5">03</div>
                      <p className="text-xs text-slate-400 font-medium mb-0.5">Monitor & Investigate</p>
                      <p className="text-[10px] text-slate-600">Review events, analyze threats, export reports</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Activity & Alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-[2.5fr_1fr] gap-5">
            <div className="h-full">
              <ActivitySummary stats={{
                networkCount: eventStats.networkCount,
                processCount: eventStats.processCount,
                fileCount: eventStats.fileCount,
                browserCount: eventStats.browserCount
              }} />
            </div>
            <div className="h-full max-h-[420px]">
              <KeyEvents events={allEvents.filter(e => e.severity === 'critical' || e.severity === 'high').slice(0, 6)} />
            </div>
          </div>

          {/* Agents & Session */}
          <div className="grid grid-cols-1 xl:grid-cols-[2.5fr_1fr] gap-5 pb-6">
            <div className="h-full">
              <EnrolledAgents agents={agents} />
            </div>
            <div className="h-full">
              <UserInsights />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
