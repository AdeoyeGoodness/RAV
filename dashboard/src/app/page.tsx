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
  const [eventStats, setEventStats] = useState({
    total: 0,
    uniqueIps: 0,
    warnings: 0,
    screenshots: 0
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

        // Calculate basic stats for the top cards
        const warnings = eventsData.filter(e => e.severity === 'warning' || e.severity === 'critical').length
        const uniqueIps = new Set(eventsData.map(e => e.metadata?.remote_ip).filter(Boolean)).size
        const screenshots = eventsData.filter(e => e.event_type === 'SCREENSHOT_TAKEN').length

        setEventStats({
          total: eventsData.length,
          uniqueIps,
          warnings,
          screenshots
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
    <div className="flex h-screen bg-[#05050A] text-slate-200 font-sans selection:bg-cyan-500/30 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64 relative">
        <Header />

        <main className="flex-1 overflow-auto p-8 space-y-6 mt-20 relative z-10 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
          {/* Top Row: Stats Overview */}
          <div className="animate-in fade-in slide-in-from-top-4 duration-500">
            <StatsRow stats={{
              agents: agents.length,
              events24h: eventStats.total,
              warnings: eventStats.warnings,
              uniqueIps: eventStats.uniqueIps,
              screenshots: eventStats.screenshots
            }} />
          </div>

          {/* Middle Row: Activity & Alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-[2.5fr_1fr] gap-6 animate-in fade-in slide-in-from-top-6 duration-700 delay-100">
            <div className="h-full">
              <ActivitySummary />
            </div>
            <div className="h-full">
              <KeyEvents />
            </div>
          </div>

          {/* Bottom Row: Agents & Insights */}
          <div className="grid grid-cols-1 xl:grid-cols-[2.5fr_1fr] gap-6 animate-in fade-in slide-in-from-top-8 duration-700 delay-200 pb-8">
            <div className="h-full min-h-[400px]">
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
