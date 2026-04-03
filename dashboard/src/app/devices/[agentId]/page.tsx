'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Monitor, Activity, Clock, HardDrive, Usb, FileText, AlertCircle, Trash2, Globe } from 'lucide-react'
import { getAgents, getEvents, deleteAgentEvents } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import USBMonitoring from '@/components/USBMonitoring'
import ScreenshotViewer from '@/components/ScreenshotViewer'
import BrowserHistoryViewer from '@/components/BrowserHistoryViewer'
import { TelemetryExplorer } from '@/components/TelemetryExplorer'
import { useAuth } from '@/contexts/AuthContext'

interface Agent {
  id: string
  agent_id: string
  hardware_fingerprint: string
  hostname: string | null
  last_seen: string
  last_seen_ms: number
  server_time_ms: number
  created_at: string
  updated_at: string
}

interface Event {
  id: string
  agent_id: string
  event_type: string
  timestamp: string
  metadata: any
  created_at: string
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

  useEffect(() => {
    if (user) {
      loadDeviceData()
      const interval = setInterval(loadDeviceData, 10000) // Refresh every 10 seconds for faster updates
      return () => clearInterval(interval)
    }
  }, [agentId, user])

  const loadDeviceData = async () => {
    setLoading(true)
    try {
      const [agentsData, eventsData] = await Promise.all([
        getAgents(),
        getEvents({ agent_id: agentId, limit: 10000 }),
      ])

      const foundAgent = agentsData.find(a => a.agent_id === agentId || a.hostname === agentId)
      if (foundAgent) {
        setAgent(foundAgent)
      } else {
        setAgent(null) // Explicitly set to null if truly not found
      }

      // Filter events to only show those after clear timestamp
      const filteredEvents = clearTimestamp
        ? eventsData.filter(event => new Date(event.timestamp) > clearTimestamp)
        : eventsData

      // If clearTimestamp is set, replace all events (don't merge with old ones)
      // Otherwise, merge new events with existing ones to prevent data loss on refresh
      if (clearTimestamp) {
        // When cleared, only show events after the clear timestamp
        // Deduplicate by ID to ensure consistency
        const uniqueEvents = Array.from(
          new Map(filteredEvents.map(e => [e.id, e])).values()
        )
        setEvents(uniqueEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()))
      } else {
        // Merge new events with existing ones to prevent data loss on refresh
        // Use Map to ensure proper deduplication by event ID
        setEvents(prevEvents => {
          const existingEventMap = new Map(prevEvents.map(e => [e.id, e]))
          filteredEvents.forEach(event => {
            existingEventMap.set(event.id, event)
          })
          // Convert back to array and ensure proper sorting
          const mergedEvents = Array.from(existingEventMap.values())
          return mergedEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        })
      }
    } catch (error) {
      console.error('Failed to load device data:', error)
    } finally {
      setLoading(false)
    }
  }

  const clearData = () => {
    if (confirm('Clear all displayed data? Only NEW events after this point will be shown. Old data will be hidden.')) {
      const now = new Date()
      setClearTimestamp(now)
      // Immediately filter out events before the clear timestamp
      setEvents(prevEvents =>
        prevEvents.filter(event => new Date(event.timestamp) > now)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      )
    }
  }

  const resetClearFilter = () => {
    setClearTimestamp(null)
    loadDeviceData()
  }

  const handleDeleteAllData = async () => {
    if (!confirm(`⚠️ WARNING: This will DELETE ALL events for device "${agentId}".\n\nAre you sure you want to continue?`)) {
      return
    }

    try {
      const result = await deleteAgentEvents(agentId)
      alert(`✅ Successfully deleted ${result.deleted_count} events for device "${agentId}"`)
      // Reload data to show empty state
      setEvents([])
      setClearTimestamp(null)
      loadDeviceData()
    } catch (error: any) {
      console.error('Failed to delete events:', error)
      alert(`❌ Failed to delete events: ${error.message || 'Unknown error'}`)
    }
  }

  const getAgentStatus = (agent: Agent) => {
    const msSinceLastSeen = agent.server_time_ms - agent.last_seen_ms;
    const minutesSinceLastSeen = msSinceLastSeen / 1000 / 60

    if (minutesSinceLastSeen < 5) return { status: 'online', color: 'text-[#00FF88]', bg: 'bg-[#00FF88]/10', border: 'border-[#00FF88]/30' }
    if (minutesSinceLastSeen < 30) return { status: 'idle', color: 'text-[#00D9FF]', bg: 'bg-[#00D9FF]/10', border: 'border-[#00D9FF]/30' }
    return { status: 'offline', color: 'text-[#FF6B6B]', bg: 'bg-[#FF6B6B]/10', border: 'border-[#FF6B6B]/30' }
  }

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
          <p className="text-cyan-500 font-medium animate-pulse font-mono tracking-widest text-xs">ENCRYPTING CONNECTION TO NODE {agentId}...</p>
        </div>
      </div>
    )
  }

  if (loading && !agent) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
          <p className="text-cyan-500 font-medium animate-pulse font-mono tracking-widest text-xs">SYNCHRONIZING WITH NODE {agentId}...</p>
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="flex h-screen transition-colors" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <Sidebar />
        <div className="flex-1 ml-64">
          <Header />
          <main className="pt-20 p-8">
            <div className="text-center py-12">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 transition-colors" style={{ color: 'rgba(255, 107, 107, 0.6)' }} />
              <p className="text-lg font-medium mb-2 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Device not found</p>
              <button
                onClick={() => router.push('/devices')}
                className="px-4 py-2 rounded-lg transition-all"
                style={{
                  backgroundColor: 'rgba(0, 217, 255, 0.2)',
                  color: 'var(--accent-cyan)'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.2)'; }}
              >
                Back to Devices
              </button>
            </div>
          </main>
        </div>
      </div>
    )
  }

  const status = getAgentStatus(agent)
  const usbEvents = events.filter(e =>
    e.event_type === 'usb_inserted' ||
    e.event_type === 'usb_removed' ||
    e.event_type === 'usb_file_transfer'
  )

  return (
    <div className="flex h-screen transition-colors" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar />
      <div className="flex-1 ml-64">
        <Header />
        <main className="pt-20 p-8 overflow-y-auto h-full">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => router.back()}
                  className="p-2 rounded-lg transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <ArrowLeft className="w-5 h-5 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
                </button>
                <div>
                  <h1 className="text-3xl font-bold transition-colors" style={{ color: 'var(--text-primary)' }}>{agent.hostname || agent.agent_id}</h1>
                  <p className="mt-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Device Details & Forensics</p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className={`px-4 py-2 rounded-lg border ${status.bg} ${status.border}`}>
                  <span className={`${status.color} font-medium`}>
                    {status.status.toUpperCase()}
                  </span>
                </div>
                <button
                  onClick={handleDeleteAllData}
                  className="px-4 py-2 rounded-lg transition-all flex items-center space-x-2 border"
                  style={{
                    backgroundColor: 'rgba(255, 107, 107, 0.2)',
                    color: '#FF6B6B',
                    borderColor: 'rgba(255, 107, 107, 0.3)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.3)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)'; }}
                  title="Delete all events for this device"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete All Data</span>
                </button>
              </div>
            </div>

            {/* Device Info Card & Network Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
              <div className="border rounded-xl p-6 transition-colors h-full" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <h2 className="text-xl font-bold mb-5 transition-colors flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Monitor className="w-5 h-5 text-cyan-500" />
                  Hardware Identity
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="flex items-center space-x-3">
                    <HardDrive className="w-5 h-5 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider transition-colors" style={{ color: 'var(--text-tertiary)' }}>Fingerprint</p>
                      <p className="text-sm font-mono transition-colors" style={{ color: 'var(--text-primary)' }}>{agent.hardware_fingerprint}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Monitor className="w-5 h-5 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider transition-colors" style={{ color: 'var(--text-tertiary)' }}>Hostname</p>
                      <p className="text-sm font-bold transition-colors" style={{ color: 'var(--text-primary)' }}>{agent.hostname || 'unknown'}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                     <Clock className="w-5 h-5 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                     <div>
                       <p className="text-xs font-bold uppercase tracking-wider transition-colors" style={{ color: 'var(--text-tertiary)' }}>Last Reporting</p>
                       <p className="text-sm transition-colors" style={{ color: 'var(--text-primary)' }}>{new Date(agent.last_seen).toLocaleString()}</p>
                     </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Activity className="w-5 h-5 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider transition-colors" style={{ color: 'var(--text-tertiary)' }}>Total Footprint</p>
                      <p className="text-sm font-bold transition-colors" style={{ color: 'var(--text-primary)' }}>{events.length} Events</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Individual Device Network Insights */}
              <div className="border rounded-xl p-6 transition-colors h-full" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xl font-bold transition-colors flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Globe className="w-5 h-5 text-cyan-400" />
                    Network Pulse
                  </h2>
                  <span className="text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded">LIVE</span>
                </div>

                <div className="space-y-4">
                  {(() => {
                    const netEvents = events.filter(e => e.event_type === 'NETWORK_CONNECTION' || e.metadata?.remote_ip);
                    const uniqueIps = Array.from(new Set(netEvents.map(e => e.metadata?.remote_ip).filter(Boolean)));
                    const topIps = Object.entries(
                      netEvents.reduce((acc: any, ev) => {
                        const ip = ev.metadata?.remote_ip;
                        if (ip) acc[ip] = (acc[ip] || 0) + 1;
                        return acc;
                      }, {})
                    ).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3);

                    return (
                      <>
                        <div className="flex items-center justify-between bg-white/[0.02] p-3 rounded-lg border border-white/[0.05]">
                          <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">Unique Connections</span>
                          <span className="text-lg font-bold text-white tabular-nums">{uniqueIps.length}</span>
                        </div>
                        
                        <div className="space-y-2.5">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Most Active Destinations</p>
                          {topIps.length > 0 ? topIps.map(([ip, count]) => (
                            <div key={ip} className="flex items-center justify-between group">
                              <span className="text-xs font-mono text-cyan-400/80 hover:text-cyan-400 transition-colors cursor-default">{ip}</span>
                              <span className="text-[10px] font-bold text-slate-600 bg-white/[0.02] px-1.5 py-0.5 rounded">{count} events</span>
                            </div>
                          )) : (
                            <p className="text-xs text-slate-600 italic">No network traffic observed in current logs.</p>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* USB Monitoring Section */}
            <USBMonitoring
              events={events}
              loading={loading}
              onRefresh={loadDeviceData}
              onClear={clearData}
              clearTimestamp={clearTimestamp}
              onResetFilter={resetClearFilter}
            />

            {/* Screenshot Viewer Section */}
            <ScreenshotViewer
              events={events}
              loading={loading}
              onRefresh={loadDeviceData}
              onClear={clearData}
              clearTimestamp={clearTimestamp}
              onResetFilter={resetClearFilter}
            />

            {/* Browser History Section */}
            <BrowserHistoryViewer
              events={events}
              loading={loading}
              onRefresh={loadDeviceData}
              onClear={clearData}
              clearTimestamp={clearTimestamp}
              onResetFilter={resetClearFilter}
            />

            {/* General Telemetry Section */}
            <div className="border rounded-2xl p-6 transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>Full Event Observation Log</h2>
              </div>
              <TelemetryExplorer initialAgentId={agentId} />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

