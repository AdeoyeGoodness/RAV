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
          <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-[#020408] text-slate-200 font-sans selection:bg-cyan-500/30 overflow-hidden relative">
      {/* Global Ambient Background Effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[150px] rounded-full pointer-events-none mix-blend-screen" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 blur-[150px] rounded-full pointer-events-none mix-blend-screen" />
      <div className="absolute top-[20%] right-[30%] w-[30%] h-[30%] bg-cyan-500/10 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />

      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64 relative z-10">
        <Header />

        <main className="flex-1 overflow-auto p-8 space-y-6 mt-20 relative z-10 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
          {/* Top Row: Stats Overview */}
          <div className="animate-in fade-in slide-in-from-top-4 duration-500">
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
          </div>

          {/* Middle Row: Activity & Alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-[2.5fr_1fr] gap-6 animate-in fade-in slide-in-from-top-6 duration-700 delay-100">
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

          {/* Bottom Row: Agents & Insights */}
          <div className="grid grid-cols-1 xl:grid-cols-[2.5fr_1fr] gap-6 animate-in fade-in slide-in-from-top-8 duration-700 delay-200 pb-8">
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
