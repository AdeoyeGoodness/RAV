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
import { TopContributors } from '@/components/dashboard/TopContributors'
import { SectionHead, Eyebrow, ActionButton, Panel } from '@/components/ct/primitives'
import {
  getAgents,
  getEvents,
  getServerTime,
  getEventsSummary,
  Agent,
  EventsSummary,
} from '@/lib/api'
import { formatWATTime } from '@/lib/time'
import { useAuth } from '@/contexts/AuthContext'
import { RefreshCw } from 'lucide-react'

export default function DashboardPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [alertEvents, setAlertEvents] = useState<any[]>([])
  const [summary, setSummary] = useState<EventsSummary | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async () => {
    if (!user) return
    setRefreshing(true)
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      // getEventsSummary — server-side aggregate, no row cap, always internally
      // consistent (sum(by_category) === total_events).
      // getEvents with a severity filter — small result set for the Forensic
      // Alerts panel (renders the actual events, not just their count).
      const [agentsData, summaryData, alertsData] = await Promise.all([
        getAgents(),
        getEventsSummary(24),
        getEvents({
          start_time: twentyFourHoursAgo,
          severity: 'critical',
          limit: 6,
        }).catch(() => [] as any[]),
      ])

      setAgents(agentsData)
      setSummary(summaryData)
      // If no critical alerts, fall back to high severity so the panel isn't empty.
      if (alertsData.length > 0) {
        setAlertEvents(alertsData)
      } else {
        try {
          const highAlerts = await getEvents({
            start_time: twentyFourHoursAgo,
            severity: 'high',
            limit: 6,
          })
          setAlertEvents(highAlerts)
        } catch {
          setAlertEvents([])
        }
      }

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

  const totalEvents = summary?.total_events ?? 0
  const isEmptyState = agents.length === 0 && totalEvents === 0

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink font-sans overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />

        <main className="flex-1 overflow-auto p-8 space-y-6 mt-20">
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

          <StatsRow
            stats={{
              agents: agents.length,
              events24h: summary?.total_events ?? 0,
              warnings: (summary?.medium_count ?? 0) + (summary?.high_count ?? 0),
              uniqueIps: summary?.unique_ips ?? 0,
              screenshots: summary?.screenshots ?? 0,
              criticalCount: summary?.critical_count ?? 0,
              highCount: summary?.high_count ?? 0,
              mediumCount: summary?.medium_count ?? 0,
              lowCount: summary?.low_count ?? 0,
            }}
          />

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
              breakdown={summary?.by_category ?? []}
              total={summary?.total_events ?? 0}
            />
            <KeyEvents events={alertEvents} />
          </div>

          {/* Top contributors + Enrolled agents */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
            <TopContributors contributors={summary?.top_contributors ?? []} total={totalEvents} />
            <UserInsights />
          </div>

          <div className="pb-8">
            <EnrolledAgents agents={agents} />
          </div>
        </main>
      </div>
    </div>
  )
}
