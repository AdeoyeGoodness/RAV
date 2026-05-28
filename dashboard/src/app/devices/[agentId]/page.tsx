'use client'

import React from 'react'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Monitor, Activity, Clock, Calendar, HardDrive, Usb, FileText, AlertCircle, Trash2, Globe, Archive, Database, ShieldAlert, Tag } from 'lucide-react'
import { getAgents, getEvents, deleteAgentEvents, triggerManualArchive, downloadArchive } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
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
  campaign?: string | null
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
  const mainRef = useRef<HTMLElement>(null)

  const loadDeviceData = useCallback(async (isInitial = false) => {
    // Preserve scroll position on non-initial (refresh) loads
    const scrollContainer = mainRef.current
    const savedScroll = scrollContainer?.scrollTop ?? 0

    if (isInitial) setLoading(true)
    try {
      const [agentsData, eventsData] = await Promise.all([
        getAgents(),
        getEvents({ agent_id: agentId, limit: 1000 }),
      ])

      const foundAgent = agentsData.find(a => a.agent_id === agentId || a.hostname === agentId)
      if (foundAgent) {
        setAgent(foundAgent)
      } else {
        setAgent(null)
      }

      const filteredEvents = clearTimestamp
        ? eventsData.filter(event => new Date(event.timestamp) > clearTimestamp)
        : eventsData

      if (clearTimestamp) {
        const uniqueEvents = Array.from(
          new Map(filteredEvents.map(e => [e.id, e])).values()
        )
        setEvents(uniqueEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()))
      } else {
        setEvents(prevEvents => {
          const existingEventMap = new Map(prevEvents.map(e => [e.id, e]))
          filteredEvents.forEach(event => {
            existingEventMap.set(event.id, event)
          })
          const mergedEvents = Array.from(existingEventMap.values())
          return mergedEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
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
  }, [agentId, clearTimestamp, user])

  useEffect(() => {
    if (user) {
      loadDeviceData(true)
    }
  }, [agentId, user, loadDeviceData])

  // Background refresh for the summary cards only (identity, network pulse,
  // telemetry volume). Each section below fetches and refreshes its own data
  // independently, so refreshing one section never touches the others.
  useEffect(() => {
    if (!user) return
    const interval = setInterval(() => {
      loadDeviceData(false)
    }, 10000)
    return () => clearInterval(interval)
  }, [user, loadDeviceData])

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

    if (minutesSinceLastSeen < 5) return { status: 'online', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.2)]' }
    if (minutesSinceLastSeen < 30) return { status: 'idle', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.2)]' }
    return { status: 'offline', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30', glow: 'shadow-[0_0_15px_rgba(244,63,94,0.2)]' }
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

  return (
    <div className="flex h-screen bg-[#020817] text-slate-200 font-sans selection:bg-cyan-500/30 relative overflow-hidden">
      {/* Background Glow Effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />
      
      <Sidebar />
      <div className="flex-1 ml-64 flex flex-col relative z-10">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />

        <main ref={mainRef} className="flex-1 overflow-y-auto p-8 pt-24 custom-scrollbar">
          <div className="max-w-7xl mx-auto space-y-8">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
              <div className="flex items-start space-x-5">
                <button
                  onClick={() => router.back()}
                  className="mt-1 p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-cyan-400 transition-all duration-300 group"
                >
                  <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                </button>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-4xl font-extrabold tracking-tight text-white flex items-center gap-3">
                      {agent.hostname || agent.agent_id}
                    </h1>
                    <div className={`px-3 py-1 rounded-full border ${status.bg} ${status.border} ${status.glow} flex items-center gap-2`}>
                      <div className={`w-2 h-2 rounded-full bg-current ${status.color} ${status.status === 'online' ? 'animate-pulse' : ''}`} />
                      <span className={`${status.color} text-xs font-bold tracking-widest uppercase`}>
                        {status.status}
                      </span>
                    </div>
                    {agent.campaign && (
                      <div className="px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 flex items-center gap-2" title="Enrollment campaign / token label">
                        <Tag className="w-3 h-3 text-cyan-400" />
                        <span className="text-cyan-300 text-xs font-bold tracking-wide uppercase">
                          {agent.campaign}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-slate-400 font-medium tracking-wide flex items-center gap-2">
                    <Monitor className="w-4 h-4 opacity-70" />
                    Forensic Device Profile
                  </p>
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleDeleteAllData}
                  className="px-5 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 hover:text-rose-300 hover:shadow-[0_0_20px_rgba(244,63,94,0.15)] transition-all duration-300 flex items-center space-x-2 font-semibold text-sm group"
                  title="Wipe all forensic data for this node"
                >
                  <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  <span>Wipe Node Data</span>
                </button>
              </div>
            </div>

            {/* Device Info Card & Network Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
              {/* Identity Card */}
              <div className="relative group bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl p-7 hover:border-cyan-500/30 transition-all duration-500 overflow-hidden shadow-xl">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <h2 className="text-xl font-bold mb-8 flex items-center gap-3 text-white">
                  <div className="p-2 bg-cyan-500/10 rounded-lg border border-cyan-500/20 text-cyan-400">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  System Identity
                </h2>
                
                <div className="space-y-7">
                  {/* Fingerprint */}
                  <div className="relative p-5 bg-black/40 rounded-xl border border-white/5 group/fp hover:border-white/10 transition-colors">
                    <div className="flex items-center space-x-3 mb-3">
                       <ShieldAlert className="w-4 h-4 text-cyan-500" />
                       <p className="text-xs font-bold uppercase tracking-[0.15em] text-cyan-500/80">Cryptographic Fingerprint</p>
                    </div>
                    <p className="text-sm font-mono text-slate-300 break-all leading-relaxed group-hover/fp:text-cyan-100 transition-colors">
                      {agent.hardware_fingerprint}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Internal Node ID</p>
                      <p className="text-base font-medium text-white">{agent.agent_id}</p>
                    </div>
                    <div>
                       <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Last Synchronized</p>
                       <p className="text-base font-medium text-white flex items-center gap-2">
                         <Clock className="w-4 h-4 text-slate-400" />
                         {new Date(agent.last_seen).toLocaleString()}
                       </p>
                    </div>
                    <div>
                       <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Installed On</p>
                       <p className="text-base font-medium text-white flex items-center gap-2">
                         <Calendar className="w-4 h-4 text-slate-400" />
                         {new Date(agent.created_at).toLocaleString()}
                       </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Telemetry Volume</p>
                      <div className="flex items-center gap-3">
                        <p className="text-2xl font-black text-white">{events.length}</p>
                        <span className="text-xs font-medium bg-white/10 px-2 py-1 rounded-md text-slate-300">Events Recorded</span>
                      </div>
                    </div>
                  </div>
                  
                  {(() => {
                    const wifiEvent = events.find(e => e.event_type === 'wifi_changed');
                    if (wifiEvent) {
                      return (
                        <div className="p-5 mt-4 bg-gradient-to-r from-cyan-950/40 to-blue-900/20 rounded-xl border border-cyan-500/20 flex items-center gap-5">
                          <div className="bg-cyan-500/20 p-3 rounded-xl border border-cyan-500/30 text-cyan-300">
                            <Globe className="w-6 h-6" />
                          </div>
                          <div className="flex-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-500 mb-1">Network Context</p>
                            <div className="flex items-center justify-between">
                              <span className="text-lg font-bold text-white tracking-tight">{wifiEvent.metadata?.current_ssid || wifiEvent.metadata?.ssid || 'Wired/Other'}</span>
                              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.1)]">
                                <Activity className="w-3 h-3 text-cyan-400 animate-pulse" />
                                <span className="text-xs font-bold text-cyan-300 uppercase">{wifiEvent.metadata?.signal || '100%'} Quality</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    }
                    return null;
                  })()}
                </div>
              </div>

              {/* Network Pulse Card */}
              <div className="relative group bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl p-7 hover:border-blue-500/30 transition-all duration-500 overflow-hidden shadow-xl flex flex-col">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-xl font-bold flex items-center gap-3 text-white">
                    <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20 text-blue-400">
                      <Activity className="w-5 h-5" />
                    </div>
                    Network Pulse
                  </h2>
                  <div className="flex items-center gap-2 bg-blue-500/10 text-blue-400 border border-blue-500/20 px-3 py-1 rounded-full">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                    <span className="text-[10px] font-black tracking-widest uppercase">Live Scan</span>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center">
                  {(() => {
                    interface IpStat {
                      count: number;
                      processes: Record<string, number>;
                    }

                    const noiseIps = ['127.0.0.1', '0.0.0.0', '::1', 'localhost'];
                    const netEvents = events.filter(e => (e.event_type === 'NETWORK_CONNECTION' || e.metadata?.remote_ip) && !noiseIps.includes(e.metadata?.remote_ip));
                    
                    const ipStats = netEvents.reduce((acc: Record<string, IpStat>, ev) => {
                      const ip = ev.metadata?.remote_ip as string;
                      if (!ip) return acc;
                      if (!acc[ip]) acc[ip] = { count: 0, processes: {} };
                      acc[ip].count++;
                      const proc = (ev.metadata?.process_name as string) || 'unknown';
                      acc[ip].processes[proc] = (acc[ip].processes[proc] || 0) + 1;
                      return acc;
                    }, {});

                    const topIps = Object.entries(ipStats)
                      .sort((a, b) => b[1].count - a[1].count)
                      .slice(0, 5);

                    const uniqueIpsCount = Object.keys(ipStats).length;

                    return (
                      <>
                        <div className="flex items-center justify-between bg-black/40 p-5 rounded-xl border border-white/5 mb-6">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Unique Destinations</span>
                          <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300 tabular-nums drop-shadow-md">
                            {uniqueIpsCount}
                          </span>
                        </div>
                        
                        <div className="flex-1 flex flex-col">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">Top External Connections</p>
                          <div className="space-y-2.5 flex-1">
                            {topIps.length > 0 ? topIps.map(([ip, data]) => {
                              const topProc = Object.entries(data.processes).sort((a: any, b: any) => b[1] - a[1])[0]?.[0];
                              return (
                                <div key={ip} className="flex items-center justify-between group/row bg-white/[0.02] p-3 rounded-lg hover:bg-blue-500/5 border border-transparent hover:border-blue-500/20 transition-all">
                                  <div className="flex flex-col gap-1">
                                    <span className="text-sm font-mono text-blue-300 font-medium">{ip}</span>
                                    <span className="text-[10px] text-slate-500 italic max-w-[150px] truncate">
                                      via {topProc}
                                    </span>
                                  </div>
                                  <div className="bg-black/50 px-2 py-1 rounded text-[11px] font-mono text-slate-400 border border-white/5">
                                    {data.count} hits
                                  </div>
                                </div>
                              )
                            }) : (
                              <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-white/5 rounded-xl bg-white/[0.01]">
                                <Globe className="w-8 h-8 text-slate-600 mb-3" />
                                <p className="text-sm text-slate-400 font-medium">No external traffic recorded.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* USB Monitoring Section */}
            <USBMonitoring
              agentId={agentId}
              onClear={clearData}
              clearTimestamp={clearTimestamp}
              onResetFilter={resetClearFilter}
            />

            {/* Screenshot Viewer Section */}
            <ScreenshotViewer
              agentId={agentId}
              onClear={clearData}
              clearTimestamp={clearTimestamp}
              onResetFilter={resetClearFilter}
            />

            {/* Browser History Section */}
            <BrowserHistoryViewer
              agentId={agentId}
              onClear={clearData}
              clearTimestamp={clearTimestamp}
              onResetFilter={resetClearFilter}
            />

            {/* Forensic Archives Section (Item 12) */}
            <div className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl p-7 shadow-xl">
              <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/5">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-violet-500/10 rounded-xl border border-violet-500/20 text-violet-400">
                    <Database className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white tracking-tight">Forensic Vault</h2>
                    <p className="text-sm text-slate-400 mt-1">Snapshot archives of historical telemetry (Auto-purged every 7 days)</p>
                  </div>
                </div>
                <button 
                  onClick={async () => {
                    if (confirm("Trigger immediate forensic archival for this device? This will bundle ALL current telemetry into a secure ZIP for retrieval.")) {
                      try {
                        const res = await triggerManualArchive(agentId);
                        if (res.status === 'success') {
                          window.location.reload();
                        } else {
                          alert(res.message || "Archive requested, check vault shortly.");
                        }
                      } catch (err) {
                        alert("Failed to reach archival orchestrator.");
                      }
                    }
                  }}
                  className="px-5 py-2.5 bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold rounded-xl shadow-[0_0_20px_rgba(139,92,246,0.3)] transition-all uppercase tracking-widest flex items-center gap-2"
                >
                  <Archive className="w-4 h-4" />
                  Request Archive
                </button>
              </div>

              <ArchivesList agentId={agentId as string} />
            </div>

            {/* General Telemetry Section */}
            <div className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl p-7 shadow-xl">
              <div className="flex items-center gap-4 mb-8 pb-6 border-b border-white/5">
                <div className="p-3 bg-slate-800 rounded-xl border border-white/10 text-slate-300">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Event Observation Log</h2>
                  <p className="text-sm text-slate-400 mt-1">Raw, unfiltered telemetry stream from the agent</p>
                </div>
              </div>
              <div className="bg-[#020817] rounded-xl border border-white/5 overflow-hidden">
                <TelemetryExplorer initialAgentId={agentId as string} />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function ArchivesList({ agentId }: { agentId: string }) {
  const [archives, setArchives] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = React.useState(false);
  const [selectedArchiveId, setSelectedArchiveId] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/agents/${agentId}/archives`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        setArchives(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agentId]);

  const initiateDownload = (id: string) => {
    setSelectedArchiveId(id);
    setPassword("");
    setIsAuthModalOpen(true);
  };

  const [downloading, setDownloading] = React.useState(false);

  const handleDownload = async () => {
    if (!password || !selectedArchiveId) return;
    setDownloading(true);
    try {
      // Authenticated POST (cookie via withCredentials); password travels in the
      // request body, never the URL. Returns the zip as a blob.
      const blob = await downloadArchive(selectedArchiveId, password);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `forensic_archive_${selectedArchiveId}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setIsAuthModalOpen(false);
      setPassword("");
      // Burned after download — refresh so the consumed archive drops off the list.
      setTimeout(() => window.location.reload(), 1000);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        alert("Incorrect password.");
      } else if (status === 404) {
        alert("This archive is no longer available (it may have already been downloaded).");
        setIsAuthModalOpen(false);
        setTimeout(() => window.location.reload(), 800);
      } else {
        alert("Download failed. Please try again.");
      }
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <div className="text-xs text-slate-500 italic">Initializing archive index...</div>;
  if (archives.length === 0) return <div className="text-xs text-slate-500 italic py-8 border-2 border-dashed border-white/5 rounded-xl text-center">No forensic archives generated yet. Archives are created automatically every 7 days.</div>;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {archives.map((archive) => (
          <div key={archive.id} className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-xl hover:bg-white/[0.04] transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div className="bg-cyan-500/10 p-2 rounded-lg group-hover:scale-110 transition-transform">
                <Archive className="w-4 h-4 text-cyan-400" />
              </div>
              <button 
                onClick={() => initiateDownload(archive.id)}
                className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors bg-cyan-500/5 px-3 py-1.5 rounded border border-cyan-500/10 uppercase"
              >
                UNLOCK & DOWNLOAD
              </button>
            </div>
            <p className="text-sm font-bold text-white mb-1">Window: {new Date(archive.start_date).toLocaleDateString()} - {new Date(archive.end_date).toLocaleDateString()}</p>
            <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-slate-500">
               <span className="flex items-center gap-1"><Database className="w-3 h-3" /> {Math.round(archive.size_bytes / 1024)} KB</span>
               <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> {archive.event_count} events</span>
            </div>
          </div>
        ))}
      </div>

      {isAuthModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 p-6 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <ShieldAlert className="w-6 h-6 text-cyan-400" />
              <h3 className="text-lg font-bold text-white">Forensic Authentication Required</h3>
            </div>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              You are attempting to download a secure telemetry archive. This file will be <span className="text-cyan-400 font-bold">PERMANENTLY DELETED</span> from the server immediately after this download starts. 
              <br/><br/>
              Enter your Admin Password below. <span className="italic">Note: For security, your typing will be invisible (SSH style).</span>
            </p>
            
            <div className="bg-black border border-white/5 p-4 rounded-xl mb-6 flex items-center gap-2 font-mono">
              <span className="text-cyan-500">$</span>
              <input 
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDownload()}
                className="bg-transparent border-none outline-none text-transparent caret-cyan-400 w-full"
                placeholder="type password..."
              />
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setIsAuthModalOpen(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 text-white text-xs font-bold py-3 rounded-xl transition-all"
              >
                CANCEL
              </button>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold py-3 rounded-xl transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {downloading ? "DECRYPTING…" : "VERIFY & DOWNLOAD"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

