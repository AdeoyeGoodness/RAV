'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Monitor, Activity, Clock, HardDrive, Search } from 'lucide-react'
import { getAgents, getEvents } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'

interface Agent {
  id: string
  agent_id: string
  hardware_fingerprint: string
  last_seen: string
  license_expiry: string | null
  created_at: string
  updated_at: string
}

export default function DevicesPage() {
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadAgents()
    const interval = setInterval(loadAgents, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])

  const loadAgents = async () => {
    try {
      const agentsData = await getAgents()
      setAgents(agentsData)
    } catch (error) {
      console.error('Failed to load agents:', error)
    } finally {
      setLoading(false)
    }
  }

  const getAgentStatus = (agent: Agent) => {
    const lastSeen = new Date(agent.last_seen)
    const now = new Date()
    const minutesSinceLastSeen = (now.getTime() - lastSeen.getTime()) / 1000 / 60
    
    if (minutesSinceLastSeen < 5) return { status: 'online', color: 'text-[#00FF88]', bg: 'bg-[#00FF88]/10', border: 'border-[#00FF88]/30' }
    if (minutesSinceLastSeen < 30) return { status: 'idle', color: 'text-[#00D9FF]', bg: 'bg-[#00D9FF]/10', border: 'border-[#00D9FF]/30' }
    return { status: 'offline', color: 'text-[#FF6B6B]', bg: 'bg-[#FF6B6B]/10', border: 'border-[#FF6B6B]/30' }
  }

  const formatLastSeen = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  }

  const filteredAgents = agents.filter(agent => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      agent.agent_id.toLowerCase().includes(query) ||
      agent.hardware_fingerprint.toLowerCase().includes(query)
    )
  })

  return (
    <div className="flex h-screen transition-colors" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar />
      <div className="flex-1 ml-64">
        <Header />
        <main className="pt-20 p-8 overflow-y-auto h-full">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-3xl font-bold mb-2 transition-colors" style={{ color: 'var(--text-primary)' }}>Devices</h1>
              <p className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Manage and monitor all connected devices</p>
            </div>

            {/* Search Bar */}
            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                <input
                  type="text"
                  placeholder="Search devices by ID or hardware fingerprint..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none transition-all"
                  style={{ 
                    backgroundColor: 'var(--bg-secondary)', 
                    borderColor: 'var(--border-color)', 
                    color: 'var(--text-primary)' 
                  }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--accent-cyan)'; }}
                  onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; }}
                />
              </div>
            </div>

            {/* Devices Grid */}
            {loading ? (
              <div className="text-center py-12">
                <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4 transition-colors" style={{ borderColor: 'var(--accent-cyan)' }} />
                <p className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Loading devices...</p>
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="text-center py-12">
                <Monitor className="w-16 h-16 mx-auto mb-4 transition-colors" style={{ color: 'rgba(0, 217, 255, 0.2)' }} />
                <p className="text-lg font-medium mb-2 transition-colors" style={{ color: 'var(--text-tertiary)' }}>No devices found</p>
                <p className="text-sm transition-colors" style={{ color: 'rgba(0, 217, 255, 0.4)' }}>
                  {searchQuery ? 'Try a different search query' : 'No devices are currently registered'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredAgents.map((agent) => {
                  const status = getAgentStatus(agent)
                  return (
                    <div
                      key={agent.id}
                      onClick={() => router.push(`/devices/${agent.agent_id}`)}
                      className={`border ${status.border} rounded-xl p-6 cursor-pointer hover:border-opacity-50 transition-all hover:transform hover:scale-[1.02]`}
                      style={{ backgroundColor: 'var(--bg-secondary)' }}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div className={`p-3 ${status.bg} rounded-lg`}>
                            <Monitor className={`w-6 h-6 ${status.color}`} />
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>
                              {agent.agent_id.length > 20 
                                ? `${agent.agent_id.substring(0, 20)}...` 
                                : agent.agent_id}
                            </h3>
                            <p className="text-xs mt-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                              {status.status.charAt(0).toUpperCase() + status.status.slice(1)}
                            </p>
                          </div>
                        </div>
                        <div className={`px-2 py-1 rounded text-xs font-medium ${status.bg} ${status.color}`}>
                          {status.status.toUpperCase()}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center space-x-2 text-sm">
                          <HardDrive className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                          <span className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Fingerprint:</span>
                          <span className="font-mono text-xs transition-colors" style={{ color: 'var(--text-primary)' }}>
                            {agent.hardware_fingerprint.substring(0, 16)}...
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 text-sm">
                          <Clock className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                          <span className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Last seen:</span>
                          <span className="transition-colors" style={{ color: 'var(--text-primary)' }}>{formatLastSeen(agent.last_seen)}</span>
                        </div>
                        <div className="flex items-center space-x-2 text-sm">
                          <Activity className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                          <span className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Registered:</span>
                          <span className="transition-colors" style={{ color: 'var(--text-primary)' }}>
                            {new Date(agent.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t transition-colors" style={{ borderColor: 'var(--border-color)' }}>
                        <button 
                          className="w-full py-2 rounded-lg transition-all text-sm font-medium"
                          style={{ backgroundColor: 'rgba(0, 217, 255, 0.2)', color: 'var(--accent-cyan)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.3)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.2)'; }}
                        >
                          View Details →
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

