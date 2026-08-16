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
import { SectionHead, Eyebrow, ActionButton, Panel } from '@/components/ct/primitives'
import { getAgents, getEvents, getServerTime, Agent } from '@/lib/api'
import { formatWATTime } from '@/lib/time'
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
    lowCount: 0,
  })

  const fetchData = useCallback(async () => {
    if (!user) return
    setRefreshing(true)
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [agentsData, eventsData] = await Promise.all([
        getAgents(),
        getEvents({ start_time: twentyFourHoursAgo, limit: 1000 }),
      ])

      setAgents(agentsData)
      setAllEvents(eventsData)

      const criticalCount = eventsData.filter((e: any) => e.severity === 'critical').length
      const highCount = eventsData.filter((e: any) => e.severity === 'high').length
      const mediumCount = eventsData.filter((e: any) => e.severity === 'medium').length
      const lowCount = eventsData.filter((e: any) => e.severity === 'low').length

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
        lowCount,
      })
      // Prefer server wall-clock; falls back to browser only if the /time
      // endpoint is unreachable. Keeps "Last sync" aligned with the header.
      try {
        const serverMs = await getServerTime()
        setLastRefresh(new Date(serverMs))
      } catch {
        setLastRefresh(new Date())
      }
    } catch (e) {
      console.error('Failed to fetch dashboard data:', e)
    } finally {
      setRefreshing(false)
    }
  }, [user])

  useEffect(() => {
    if (user && !isLoading) {
      if (user.role === 'super_admin') {
        router.replace('/admin')
      } else {
        fetchData()
      }
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !user || user.role === 'super_admin') {
    return (
      <div className="min-h-screen bg-ct-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-8 h-8 rounded-full animate-spin"
            style={{
              borderWidth: 2,
              borderStyle: 'solid',
              borderColor: 'var(--ct-line2)',
              borderTopColor: 'var(--ct-accent)',
            }}
          />
          <span
            className="text-[10px] font-mono uppercase text-ct-ink3"
            style={{ letterSpacing: '0.28em' }}
          >
            Initializing
          </span>
        </div>
      </div>
    )
  }

  const isEmptyState = agents.length === 0 && eventStats.total === 0

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink font-sans overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />

        <main className="flex-1 overflow-auto p-8 space-y-6 mt-20">
          {/* Top bar */}
          <SectionHead
            eyebrow="Command Terminal · Live"
            title="Command Centre"
            right={
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <Eyebrow>Last sync</Eyebrow>
                  <div className="font-mono text-[12px] text-ct-ink tabular-nums mt-1">
                    {lastRefresh ? formatWATTime(lastRefresh) : '--:--:--'}
                  </div>
                </div>
                <ActionButton onClick={fetchData} disabled={refreshing}>
                  <RefreshCw className={`w-3 h-3 inline mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                  {refreshing ? 'Syncing' : 'Refresh'}
                </ActionButton>
              </div>
            }
          />

          {/* KPI strip */}
          <StatsRow
            stats={{
              agents: agents.length,
              events24h: eventStats.total,
              warnings: eventStats.warnings,
              uniqueIps: eventStats.uniqueIps,
              screenshots: eventStats.screenshots,
              criticalCount: eventStats.criticalCount,
              highCount: eventStats.highCount,
              mediumCount: eventStats.mediumCount,
              lowCount: eventStats.lowCount,
            }}
          />

          {/* Getting Started */}
          {isEmptyState && (
            <Panel>
              <div className="p-6">
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className="w-[8px] h-[8px] rounded-full animate-ct-pulse"
                    style={{ background: 'var(--ct-accent)' }}
                  />
                  <Eyebrow>Getting started</Eyebrow>
                </div>
                <p className="text-[13px] text-ct-ink2 mb-6 max-w-2xl">
                  Deploy the RAV agent to a Windows endpoint to begin collecting telemetry. The
                  command centre populates as data arrives.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { step: '01', title: 'Deploy agent', desc: 'Install RAV on target Windows endpoints via MSI' },
                    { step: '02', title: 'Configure policies', desc: 'Set monitoring rules, keywords, alert thresholds' },
                    { step: '03', title: 'Investigate', desc: 'Review events, analyse threats, export forensic bundles' },
                  ].map(({ step, title, desc }) => (
                    <div key={step} className="p-4 rounded-[3px] bg-ct-bg2 border border-ct-line">
                      <div
                        className="font-mono text-[10px] text-ct-accent mb-3"
                        style={{ letterSpacing: '0.22em' }}
                      >
                        {step}
                      </div>
                      <div className="text-[13px] font-medium text-ct-ink mb-1">{title}</div>
                      <div className="text-[11px] text-ct-ink3 leading-relaxed">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {/* Activity + alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
            <ActivitySummary
              stats={{
                networkCount: eventStats.networkCount,
                processCount: eventStats.processCount,
                fileCount: eventStats.fileCount,
                browserCount: eventStats.browserCount,
              }}
            />
            <KeyEvents events={allEvents.filter((e) => e.severity === 'critical' || e.severity === 'high').slice(0, 6)} />
          </div>

          {/* Agents + session */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 pb-8">
            <EnrolledAgents agents={agents} />
            <UserInsights />
          </div>
        </main>
      </div>
    </div>
  )
}
