'use client'

import React from 'react'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Activity,
  Clock,
  Calendar,
  HardDrive,
  FileText,
  AlertCircle,
  Trash2,
  Globe,
  Archive,
  Database,
  ShieldAlert,
  Edit2,
  Check,
  X,
} from 'lucide-react'
import {
  getAgents,
  getEvents,
  deleteAgentEvents,
  triggerManualArchive,
  downloadArchive,
  updateAgentDisplayName,
} from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import NextArchiveBanner from '@/components/NextArchiveBanner'
import USBMonitoring from '@/components/USBMonitoring'
import ScreenshotViewer from '@/components/ScreenshotViewer'
import AgentReport from '@/components/AgentReport'
import CriticalSection from '@/components/CriticalSection'
import BrowserHistoryViewer from '@/components/BrowserHistoryViewer'
import { TelemetryExplorer } from '@/components/TelemetryExplorer'
import { useAuth } from '@/contexts/AuthContext'
import { formatWAT, formatWATDate } from '@/lib/time'
import { eventServerTime, eventServerMs, formatSkew } from '@/lib/eventTime'
import { Panel, PanelHead, Eyebrow, StatusPill, ActionButton } from '@/components/ct/primitives'
import { Counter } from '@/components/ct/Counter'

interface Agent {
  id: string
  agent_id: string
  hardware_fingerprint: string
  hostname: string | null
  display_name?: string | null
  last_seen: string
  last_seen_ms: number
  server_time_ms: number
  created_at: string
  updated_at: string
  campaign?: string | null
  uploader_health?: 'ok' | 'stale' | 'dark' | 'unknown'
  latest_event_at?: string | null
  latest_event_at_ms?: number | null
  last_archived_at?: string | null
  last_archived_at_ms?: number | null
}

interface Event {
  id: string
  agent_id: string
  event_type: string
  timestamp: string
  metadata: any
  received_at?: string
  created_at: string
}

function statusTone(a: Agent): { tone: 'ok' | 'warn' | 'crit'; label: string } {
  const mins = (a.server_time_ms - a.last_seen_ms) / 60000
  if (mins < 5) return { tone: 'ok', label: 'Online · beaconing' }
  if (mins < 30) return { tone: 'warn', label: 'Idle · reachable' }
  return { tone: 'crit', label: 'Offline' }
}

function latestEventLabel(a: Agent): string {
  if (!a.latest_event_at_ms) return 'no events'
  const diffMs = a.server_time_ms - a.latest_event_at_ms
  const mins = Math.floor(diffMs / 60000)
  const hrs = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (hrs < 24) return `${hrs} h ago`
  return `${days} d ago`
}

function lastArchivedLabel(a: Agent): string {
  if (!a.last_archived_at_ms) return 'never'
  const diffMs = a.server_time_ms - a.last_archived_at_ms
  const hrs = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)
  if (hrs < 1) return 'just now'
  if (hrs < 24) return `${hrs} h ago`
  if (days < 7) return `${days} d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks} w ago`
}

export default function DeviceDetailsPage() {
  const { user, isLoading } = useAuth()
  const params = useParams()
  const router = useRouter()
  const agentId = params.agentId as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [clearTimestamp, setClearTimestamp] = useState<Date | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  const loadDeviceData = useCallback(
    async (isInitial = false) => {
      const scrollContainer = mainRef.current
      const savedScroll = scrollContainer?.scrollTop ?? 0
      if (isInitial) setLoading(true)
      try {
        const [agentsData, eventsData] = await Promise.all([
          getAgents(),
          getEvents({ agent_id: agentId, limit: 1000 }),
        ])
        const foundAgent = agentsData.find((a) => a.agent_id === agentId || a.hostname === agentId)
        setAgent(foundAgent || null)

        const filteredEvents = clearTimestamp
          ? eventsData.filter((event) => eventServerMs(event) > clearTimestamp.getTime())
          : eventsData

        if (clearTimestamp) {
          const uniqueEvents = Array.from(new Map(filteredEvents.map((e) => [e.id, e])).values())
          setEvents(uniqueEvents.sort((a, b) => eventServerMs(b) - eventServerMs(a)))
        } else {
          setEvents((prevEvents) => {
            const existingEventMap = new Map(prevEvents.map((e) => [e.id, e]))
            filteredEvents.forEach((event) => existingEventMap.set(event.id, event))
            return Array.from(existingEventMap.values()).sort(
              (a, b) => eventServerMs(b) - eventServerMs(a),
            )
          })
        }
      } catch (error) {
        console.error('Failed to load device data:', error)
      } finally {
        setLoading(false)
        if (!isInitial && scrollContainer) {
          requestAnimationFrame(() => {
            scrollContainer.scrollTop = savedScroll
          })
        }
      }
    },
    [agentId, clearTimestamp],
  )

  useEffect(() => {
    if (user) loadDeviceData(true)
  }, [agentId, user, loadDeviceData])

  useEffect(() => {
    if (!user) return
    const interval = setInterval(() => loadDeviceData(false), 10000)
    return () => clearInterval(interval)
  }, [user, loadDeviceData])

  const clearData = () => {
    if (confirm('Clear all displayed data? Only NEW events after this point will be shown. Old data will be hidden.')) {
      const now = new Date()
      setClearTimestamp(now)
      setEvents((prevEvents) =>
        prevEvents
          .filter((event) => eventServerMs(event) > now.getTime())
          .sort((a, b) => eventServerMs(b) - eventServerMs(a)),
      )
    }
  }

  const resetClearFilter = () => {
    setClearTimestamp(null)
    loadDeviceData()
  }

  const handleDeleteAllData = async () => {
    if (!confirm(`WARNING: This will DELETE ALL events for device "${agentId}".\n\nContinue?`)) return
    try {
      const result = await deleteAgentEvents(agentId)
      alert(`Successfully deleted ${result.deleted_count} events for device "${agentId}"`)
      setEvents([])
      setClearTimestamp(null)
      loadDeviceData()
    } catch (error: any) {
      console.error('Failed to delete events:', error)
      alert(`Failed to delete events: ${error.message || 'Unknown error'}`)
    }
  }

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-ct-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full animate-spin"
            style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }}
          />
          <span className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.24em' }}>
            Authenticating
          </span>
        </div>
      </div>
    )
  }

  if (loading && !agent) {
    return (
      <div className="min-h-screen bg-ct-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full animate-spin"
            style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }}
          />
          <span className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.24em' }}>
            Syncing with endpoint
          </span>
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="flex h-screen bg-ct-bg text-ct-ink">
        <Sidebar />
        <div className="flex-1 ml-64">
          <Header />
          <main className="pt-24 p-8">
            <div className="text-center py-16">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 text-ct-crit" />
              <p className="text-[14px] font-medium text-ct-ink2 mb-4">Endpoint not found</p>
              <ActionButton onClick={() => router.push('/devices')}>Back to registry</ActionButton>
            </div>
          </main>
        </div>
      </div>
    )
  }

  const st = statusTone(agent)
  const initials = (agent.hostname || agent.agent_id).slice(0, 2).toUpperCase()

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />
        <NextArchiveBanner />

        <main ref={mainRef} className="flex-1 overflow-y-auto p-8 mt-20 space-y-6">
          {/* Breadcrumb + Header */}
          <div>
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-[11px] font-mono uppercase text-ct-ink3 hover:text-ct-accent transition-colors mb-4"
              style={{ letterSpacing: '0.20em' }}
            >
              <ArrowLeft className="w-3 h-3" />
              Devices / {agent.display_name || agent.hostname || agent.agent_id.slice(0, 18)}
            </button>

            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-4">
                <div
                  className="w-14 h-14 rounded-[3px] flex items-center justify-center font-mono text-[18px] font-semibold text-ct-accent shrink-0"
                  style={{ background: 'var(--ct-accent-soft)', border: '1px solid var(--ct-accent-border)' }}
                >
                  {initials}
                </div>
                <div>
                  <h1 className="text-[26px] font-semibold text-ct-ink" style={{ letterSpacing: '-0.005em' }}>
                    {agent.display_name || agent.hostname || 'Unnamed endpoint'}
                  </h1>
                  <div className="font-mono text-[11px] text-ct-ink3 mt-1" style={{ letterSpacing: '0.06em' }}>
                    {agent.hostname && agent.display_name ? `${agent.hostname} · ` : ''}
                    {agent.agent_id}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {(user?.role === 'org_admin' || user?.role === 'super_admin') && (
                  <ActionButton variant="danger" onClick={handleDeleteAllData}>
                    <Trash2 className="w-3 h-3 inline mr-2" /> Wipe endpoint data
                  </ActionButton>
                )}
              </div>
            </div>
          </div>

          {/* Profile row */}
          <Panel padding={false}>
            <div className="grid grid-cols-2 md:grid-cols-6 divide-x divide-ct-line">
              <ProfileMeta
                label="Status"
                value={
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                    {(agent.uploader_health === 'stale' || agent.uploader_health === 'dark') && (
                      <StatusPill tone="crit">
                        {agent.uploader_health === 'dark' ? 'no events ever' : 'uploader stalled'}
                      </StatusPill>
                    )}
                  </div>
                }
              />
              <ProfileMeta label="Campaign" value={agent.campaign ? <StatusPill tone="accent" dot={false}>{agent.campaign}</StatusPill> : <span className="text-ct-ink3 font-mono text-[11px]">Unassigned</span>} />
              <ProfileMeta
                label="Registered"
                value={
                  <span
                    className="font-mono text-[12px] text-ct-ink2 tabular-nums"
                    title="When this device enrolled into the dashboard"
                  >
                    {agent.created_at ? formatWAT(agent.created_at) : '—'}
                  </span>
                }
              />
              <ProfileMeta
                label="Last heartbeat"
                value={
                  <span className="font-mono text-[12px] text-ct-ink tabular-nums">
                    {formatWAT(agent.last_seen)}
                  </span>
                }
              />
              <ProfileMeta
                label="Latest event"
                value={
                  <span
                    className="font-mono text-[12px] tabular-nums"
                    style={{
                      color:
                        agent.uploader_health === 'stale' || agent.uploader_health === 'dark'
                          ? 'var(--ct-crit)'
                          : 'var(--ct-ink2)',
                    }}
                  >
                    {latestEventLabel(agent)}
                  </span>
                }
              />
              <ProfileMeta
                label="Last archive"
                value={
                  <span
                    className="font-mono text-[12px] tabular-nums"
                    style={{
                      color: !agent.last_archived_at_ms
                        ? 'var(--ct-ink3)'
                        : (agent.server_time_ms - (agent.last_archived_at_ms || 0)) > 7 * 24 * 3600 * 1000
                          ? 'var(--ct-warn)'
                          : 'var(--ct-ink2)',
                    }}
                    title={
                      agent.last_archived_at
                        ? `Latest forensic bundle: ${formatWAT(agent.last_archived_at)}`
                        : 'No forensic archives on record — bundle written on the next weekly sweep or manual trigger.'
                    }
                  >
                    {lastArchivedLabel(agent)}
                  </span>
                }
              />
            </div>
          </Panel>

          {/* Identity + Network pulse */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
            {/* Identity panel */}
            <Panel>
              <PanelHead
                title="System identity"
                meta="Immutable fingerprint · editable label"
                right={
                  <span
                    className="inline-flex items-center gap-2 font-mono text-[10px] uppercase text-ct-ink3"
                    style={{ letterSpacing: '0.20em' }}
                  >
                    <HardDrive className="w-3 h-3" /> Hardware
                  </span>
                }
              />
              <div className="p-5 space-y-5">
                {/* Fingerprint */}
                <div
                  className="p-4 rounded-[3px]"
                  style={{ background: 'var(--ct-bg2)', border: '1px solid var(--ct-line)' }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert className="w-3 h-3 text-ct-accent" />
                    <Eyebrow>Cryptographic fingerprint</Eyebrow>
                  </div>
                  <p className="text-[12px] font-mono text-ct-ink break-all leading-relaxed" style={{ letterSpacing: '0.02em' }}>
                    {agent.hardware_fingerprint}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Display name */}
                  <div>
                    <Eyebrow className="mb-2">Display name</Eyebrow>
                    {editingName ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          autoFocus
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          placeholder={agent.hostname || agent.agent_id}
                          maxLength={100}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setEditingName(false)
                              setNameDraft('')
                              setNameError(null)
                            }
                          }}
                          className="flex-1 px-3 py-1.5 rounded-sm text-[13px] font-medium text-ct-ink outline-none"
                          style={{ background: 'var(--ct-panel-hi)', border: '1px solid var(--ct-accent-border)' }}
                        />
                        <button
                          disabled={savingName}
                          onClick={async () => {
                            setSavingName(true)
                            setNameError(null)
                            try {
                              const trimmed = nameDraft.trim()
                              await updateAgentDisplayName(agent.agent_id, trimmed || null)
                              setAgent({ ...agent, display_name: trimmed || null })
                              setEditingName(false)
                            } catch (err: any) {
                              setNameError(err?.response?.data?.message || 'Failed to update name')
                            } finally {
                              setSavingName(false)
                            }
                          }}
                          className="p-1.5 rounded-sm disabled:opacity-50"
                          style={{ background: 'var(--ct-accent-soft)', border: '1px solid var(--ct-accent-border)', color: 'var(--ct-accent)' }}
                          title="Save"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          disabled={savingName}
                          onClick={() => {
                            setEditingName(false)
                            setNameDraft('')
                            setNameError(null)
                          }}
                          className="p-1.5 rounded-sm text-ct-ink3"
                          style={{ background: 'var(--ct-bg2)', border: '1px solid var(--ct-line2)' }}
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <p className="text-[14px] font-medium text-ct-ink">
                          {agent.display_name || agent.hostname || agent.agent_id.slice(0, 22)}
                        </p>
                        {(user?.role === 'org_admin' || user?.role === 'super_admin') && (
                          <button
                            onClick={() => {
                              setNameDraft(agent.display_name || '')
                              setEditingName(true)
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-ct-ink3 hover:text-ct-accent hover:bg-ct-panel-hi border border-ct-line hover:border-ct-accent-border transition-colors"
                            title="Rename device (label only)"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span className="text-[9px] font-mono uppercase" style={{ letterSpacing: '0.14em' }}>Rename</span>
                          </button>
                        )}
                      </div>
                    )}
                    {nameError && <p className="text-[10px] text-ct-crit mt-1 font-mono">{nameError}</p>}
                  </div>

                  {/* Telemetry volume — animates from the previous value to
                      the new one on the 10s polling cycle, so the counter is
                      a visible pulse when fresh events arrive. */}
                  <div>
                    <Eyebrow className="mb-2">Telemetry volume</Eyebrow>
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-[24px] font-medium text-ct-ink tabular-nums">
                        <Counter value={events.length} />
                      </span>
                      <span className="font-mono text-[10px] text-ct-ink3 uppercase" style={{ letterSpacing: '0.14em' }}>
                        events
                      </span>
                    </div>
                  </div>
                </div>

                {/* Wi-Fi context */}
                {(() => {
                  const wifiEvent = events.find((e) => e.event_type === 'wifi_changed')
                  if (!wifiEvent) return null
                  return (
                    <div
                      className="p-4 rounded-[3px] flex items-center gap-4"
                      style={{ background: 'var(--ct-accent-soft)', border: '1px solid var(--ct-accent-border)' }}
                    >
                      <div
                        className="p-2 rounded-[3px]"
                        style={{ background: 'var(--ct-bg2)', border: '1px solid var(--ct-accent-border)' }}
                      >
                        <Globe className="w-4 h-4 text-ct-accent" />
                      </div>
                      <div className="flex-1 flex items-center justify-between">
                        <div>
                          <Eyebrow className="mb-1 text-ct-accent">Network context</Eyebrow>
                          <div className="text-[14px] font-medium text-ct-ink">
                            {wifiEvent.metadata?.current_ssid || wifiEvent.metadata?.ssid || 'Wired / other'}
                          </div>
                        </div>
                        <StatusPill tone="accent">
                          {wifiEvent.metadata?.signal || '100%'} quality
                        </StatusPill>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </Panel>

            {/* Network pulse */}
            <Panel className="flex flex-col">
              <PanelHead title="Network pulse" meta="Top external destinations · live" live />
              <div className="p-5 flex-1 flex flex-col">
                {(() => {
                  interface IpStat {
                    count: number
                    processes: Record<string, number>
                  }

                  const noiseIps = ['127.0.0.1', '0.0.0.0', '::1', 'localhost']
                  const netEvents = events.filter(
                    (e) => (e.event_type === 'NETWORK_CONNECTION' || e.metadata?.remote_ip) && !noiseIps.includes(e.metadata?.remote_ip),
                  )
                  const ipStats = netEvents.reduce((acc: Record<string, IpStat>, ev) => {
                    const ip = ev.metadata?.remote_ip as string
                    if (!ip) return acc
                    if (!acc[ip]) acc[ip] = { count: 0, processes: {} }
                    acc[ip].count++
                    const proc = (ev.metadata?.process_name as string) || 'unknown'
                    acc[ip].processes[proc] = (acc[ip].processes[proc] || 0) + 1
                    return acc
                  }, {})
                  const topIps = Object.entries(ipStats)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 5)
                  const uniqueIpsCount = Object.keys(ipStats).length

                  return (
                    <>
                      <div
                        className="flex items-center justify-between p-4 rounded-[3px] mb-4"
                        style={{ background: 'var(--ct-bg2)', border: '1px solid var(--ct-line)' }}
                      >
                        <Eyebrow>Unique destinations</Eyebrow>
                        <span className="font-mono text-[26px] font-medium text-ct-accent tabular-nums">
                          {uniqueIpsCount.toLocaleString()}
                        </span>
                      </div>
                      <Eyebrow className="mb-2">Top external connections</Eyebrow>
                      {topIps.length > 0 ? (
                        <div className="space-y-1 flex-1">
                          {topIps.map(([ip, data]) => {
                            const topProc = Object.entries(data.processes).sort((a: any, b: any) => b[1] - a[1])[0]?.[0]
                            return (
                              <div
                                key={ip}
                                className="flex items-center justify-between px-3 py-2 rounded-sm hover:bg-ct-panel-hi transition-colors"
                                style={{ border: '1px solid var(--ct-line)' }}
                              >
                                <div className="min-w-0">
                                  <div className="font-mono text-[12px] text-ct-ink tabular-nums truncate">{ip}</div>
                                  <div className="font-mono text-[10px] text-ct-ink3 truncate mt-0.5" style={{ letterSpacing: '0.06em' }}>
                                    via {topProc}
                                  </div>
                                </div>
                                <span className="font-mono text-[11px] text-ct-ink2 tabular-nums shrink-0 ml-3">
                                  {data.count} hits
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center py-8">
                          <Globe className="w-6 h-6 text-ct-ink4 mb-3" />
                          <p className="text-[12px] text-ct-ink3">No external traffic recorded</p>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            </Panel>
          </div>

          {/* USB */}
          <USBMonitoring agentId={agentId} onClear={clearData} clearTimestamp={clearTimestamp} onResetFilter={resetClearFilter} />

          {/* Screenshots */}
          <AgentReport agentId={agentId as string} agent={agent} />

          <ScreenshotViewer agentId={agentId} onClear={clearData} clearTimestamp={clearTimestamp} onResetFilter={resetClearFilter} />

          {/* OCR criticals */}
          <CriticalSection agentId={agentId} />

          {/* Browser history */}
          <BrowserHistoryViewer agentId={agentId} onClear={clearData} clearTimestamp={clearTimestamp} onResetFilter={resetClearFilter} />

          {/* Forensic vault */}
          <Panel>
            <PanelHead
              title="Forensic vault"
              meta="Snapshot archives · auto-purge every 7 days"
              right={
                (user?.role === 'org_admin' || user?.role === 'super_admin') && (
                  <ActionButton
                    disabled={archiving}
                    onClick={async () => {
                      if (confirm('Trigger immediate forensic archival for this device? This will bundle ALL current telemetry into a secure ZIP for retrieval.')) {
                        setArchiving(true)
                        try {
                          const res = await triggerManualArchive(agentId)
                          if (res.status === 'success') {
                            window.location.reload()
                          } else {
                            alert(res.message || 'Archive requested, check vault shortly.')
                          }
                        } catch {
                          alert('Failed to reach archival orchestrator.')
                        } finally {
                          setArchiving(false)
                        }
                      }
                    }}
                  >
                    <Archive className={`w-3 h-3 inline mr-2 ${archiving ? 'animate-pulse' : ''}`} />
                    {archiving ? 'Archiving… (up to a minute)' : 'Request archive'}
                  </ActionButton>
                )
              }
            />
            <div className="p-5">
              <ArchivesList agentId={agentId as string} />
            </div>
          </Panel>

          {/* Telemetry stream */}
          <Panel>
            <PanelHead title="Event observation log" meta="Raw, unfiltered telemetry stream" live />
            <div className="p-0">
              <TelemetryExplorer initialAgentId={agentId as string} />
            </div>
          </Panel>
        </main>
      </div>
    </div>
  )
}

function ProfileMeta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: '18px 20px' }}>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2">{value}</div>
    </div>
  )
}

function ArchivesList({ agentId }: { agentId: string }) {
  const [archives, setArchives] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [isAuthModalOpen, setIsAuthModalOpen] = React.useState(false)
  const [selectedArchiveId, setSelectedArchiveId] = React.useState<string | null>(null)
  const [password, setPassword] = React.useState('')
  const [downloading, setDownloading] = React.useState(false)

  React.useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/agents/${agentId}/archives`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setArchives(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [agentId])

  const initiateDownload = (id: string) => {
    setSelectedArchiveId(id)
    setPassword('')
    setIsAuthModalOpen(true)
  }

  const handleDownload = async () => {
    if (!password || !selectedArchiveId) return
    setDownloading(true)
    try {
      const blob = await downloadArchive(selectedArchiveId, password)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `forensic_archive_${selectedArchiveId}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      setIsAuthModalOpen(false)
      setPassword('')
      setTimeout(() => window.location.reload(), 1000)
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 401) alert('Incorrect password.')
      else if (status === 404) {
        alert('This archive is no longer available (it may have already been downloaded).')
        setIsAuthModalOpen(false)
        setTimeout(() => window.location.reload(), 800)
      } else alert('Download failed. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) return <div className="text-[11px] text-ct-ink3 font-mono italic">Initialising archive index…</div>
  if (archives.length === 0)
    return (
      <div
        className="text-[11px] text-ct-ink3 py-10 text-center rounded-[3px]"
        style={{ border: '1px dashed var(--ct-line2)' }}
      >
        No forensic archives generated yet. Archives are created automatically every 7 days.
      </div>
    )

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {archives.map((archive) => (
          <div
            key={archive.id}
            className="p-4 rounded-[3px]"
            style={{ background: 'var(--ct-bg2)', border: '1px solid var(--ct-line)' }}
          >
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-8 h-8 rounded-sm flex items-center justify-center"
                style={{ background: 'var(--ct-accent-soft)', border: '1px solid var(--ct-accent-border)' }}
              >
                <Archive className="w-3.5 h-3.5 text-ct-accent" />
              </div>
              <ActionButton onClick={() => initiateDownload(archive.id)}>Unlock &amp; download</ActionButton>
            </div>
            <div className="text-[12px] text-ct-ink font-medium mb-2">
              {formatWATDate(archive.start_date)} → {formatWATDate(archive.end_date)}
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] text-ct-ink3" style={{ letterSpacing: '0.06em' }}>
              <span className="flex items-center gap-1 tabular-nums">
                <Database className="w-3 h-3" /> {Math.round(archive.size_bytes / 1024)} KB
              </span>
              <span className="flex items-center gap-1 tabular-nums">
                <Activity className="w-3 h-3" /> {archive.event_count} events
              </span>
            </div>
          </div>
        ))}
      </div>

      {isAuthModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
          <div
            className="w-full max-w-md rounded-[3px] p-6"
            style={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-line2)' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <ShieldAlert className="w-4 h-4 text-ct-accent" />
              <div>
                <div className="text-[14px] font-semibold text-ct-ink">Forensic authentication</div>
                <Eyebrow className="mt-1">One-time password verification</Eyebrow>
              </div>
            </div>
            <p className="text-[12px] text-ct-ink2 mb-5 leading-relaxed">
              You are attempting to download a secure telemetry archive. This file will be{' '}
              <span className="text-ct-crit font-semibold">permanently deleted</span> from the server immediately after this
              download starts.
            </p>

            <div
              className="flex items-center gap-2 p-3 rounded-sm mb-5 font-mono"
              style={{ background: 'var(--ct-bg)', border: '1px solid var(--ct-line2)' }}
            >
              <span className="text-ct-accent">$</span>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDownload()}
                className="bg-transparent border-none outline-none text-transparent caret-ct-accent w-full text-[13px]"
                style={{ caretColor: 'var(--ct-accent)' }}
                placeholder="type password…"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setIsAuthModalOpen(false)}
                className="flex-1 font-mono text-[11px] uppercase text-ct-ink2 py-2 rounded-sm transition-colors"
                style={{ background: 'transparent', border: '1px solid var(--ct-line2)', letterSpacing: '0.18em' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex-1 font-mono text-[11px] uppercase py-2 rounded-sm transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--ct-accent-soft)',
                  border: '1px solid var(--ct-accent-border)',
                  color: 'var(--ct-accent)',
                  letterSpacing: '0.18em',
                }}
              >
                {downloading ? 'Decrypting…' : 'Verify & download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
