'use client'

import React from 'react'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Monitor, Activity, Clock, HardDrive, Usb, FileText, AlertCircle, Trash2, Globe, Archive, Database, ShieldAlert } from 'lucide-react'
import { getAgents, getEvents, deleteAgentEvents, triggerManualArchive } from '@/lib/api'
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
                <h2 className="text-xl font-bold mb-6 transition-colors flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Monitor className="w-5 h-5 text-cyan-500" />
                  Hardware Identity
                </h2>
                <div className="space-y-6">
                  {/* Fingerprint gets its own row to prevent overlap */}
                  <div className="p-4 bg-white/[0.02] rounded-lg border border-white/[0.05]">
                    <div className="flex items-center space-x-3 mb-2">
                       <HardDrive className="w-4 h-4 text-slate-500" />
                       <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Hardware Fingerprint</p>
                    </div>
                    <p className="text-xs font-mono text-cyan-400/70 break-all leading-relaxed">{agent.hardware_fingerprint}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                  
                  {(() => {
                    const wifiEvent = events.find(e => e.event_type === 'wifi_status');
                    if (wifiEvent) {
                      return (
                        <div className="p-4 bg-cyan-500/5 rounded-xl border border-cyan-500/10 flex items-center gap-4">
                          <div className="bg-cyan-500/10 p-2.5 rounded-lg border border-cyan-500/20">
                            <Globe className="w-5 h-5 text-cyan-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-500 mb-0.5">Network Context</p>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-bold text-white tracking-tight">{wifiEvent.metadata?.ssid || 'Wired/Other'}</span>
                              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20">
                                <Activity className="w-2.5 h-2.5 text-cyan-400" />
                                <span className="text-[9px] font-bold text-cyan-300 uppercase">{wifiEvent.metadata?.signal || '100%'} Strength</span>
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
                      .slice(0, 6);

                    const uniqueIpsCount = Object.keys(ipStats).length;

                    return (
                      <>
                        <div className="flex items-center justify-between bg-white/[0.02] p-4 rounded-lg border border-white/[0.05]">
                          <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">Unique Destinations</span>
                          <span className="text-xl font-bold text-white tabular-nums">{uniqueIpsCount}</span>
                        </div>
                        
                        <div className="space-y-3">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Most Active External Connections</p>
                          {topIps.length > 0 ? topIps.map(([ip, data]) => {
                            const topProc = Object.entries(data.processes).sort((a: any, b: any) => b[1] - a[1])[0]?.[0];
                            return (
                              <div key={ip} className="flex flex-col space-y-1 group bg-white/[0.01] p-2 rounded-md hover:bg-white/[0.03] transition-colors">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-mono text-cyan-400 font-bold">{ip}</span>
                                  <span className="text-[10px] font-mono text-slate-600 tabular-nums">{data.count} hits</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-1 h-1 rounded-full bg-cyan-500/40" />
                                  <span className="text-[10px] text-slate-500 truncate max-w-[150px] italic">via {topProc}</span>
                                </div>
                              </div>
                            )
                          }) : (
                            <p className="text-xs text-slate-600 italic py-4">No external network traffic observed.</p>
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

            {/* Forensic Archives Section (Item 12) */}
            <div className="border rounded-2xl p-6 transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold transition-colors" style={{ color: 'var(--text-primary)' }}>Weekly Forensic Vault</h2>
                  <p className="text-sm text-slate-500 mt-1">Snapshot archives of historical telemetry (Auto-purged every 7 days)</p>
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
                  className="px-4 py-2 bg-cyan-500/10 text-cyan-400 text-xs font-bold rounded-lg border border-cyan-500/20 hover:bg-cyan-500/20 transition-all uppercase tracking-wider"
                >
                  Request On-Demand Archive
                </button>
              </div>

              <ArchivesList agentId={agentId as string} />
            </div>

            {/* General Telemetry Section */}
            <div className="border rounded-2xl p-6 transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>Full Event Observation Log</h2>
              </div>
              <TelemetryExplorer initialAgentId={agentId as string} />
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
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/agents/${agentId}/archives`)
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

  const handleDownload = () => {
    if (!password) return;
    const url = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/archives/${selectedArchiveId}/download?password=${encodeURIComponent(password)}`;
    window.location.href = url;
    setIsAuthModalOpen(false);
    // Reload archives after a small delay since it burns after download
    setTimeout(() => {
      window.location.reload();
    }, 2000);
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
                className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold py-3 rounded-xl transition-all shadow-lg shadow-cyan-500/20"
              >
                VERIFY & DOWNLOAD
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

