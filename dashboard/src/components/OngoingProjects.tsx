'use client'

import { CheckCircle2, Activity, Users, Clock } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Agent {
  id: string
  agent_id: string
  last_seen: string
  hardware_fingerprint: string
}

interface OngoingProjectsProps {
  agents: Agent[]
  events: any[]
  loading: boolean
}

export default function OngoingProjects({ agents, events, loading }: OngoingProjectsProps) {
  const getProjectColor = (index: number) => {
    const colors = [
      'bg-gradient-to-br from-[#6C5CE7] to-[#8B7ED8]',
      'bg-gradient-to-br from-[#00D9FF] to-[#00B8E6]',
      'bg-gradient-to-br from-[#00FF88] to-[#00E677]',
      'bg-gradient-to-br from-[#FFD700] to-[#FFA500]',
    ]
    return colors[index % colors.length]
  }

  const getAgentStats = (agentId: string) => {
    const agentEvents = events.filter(e => e.agent_id === agentId)
    const eventTypes = new Set(agentEvents.map(e => e.event_type))
    const recentEvents = agentEvents.filter(e => {
      const eventDate = new Date(e.timestamp)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      return eventDate > oneDayAgo
    }).length

    return {
      totalEvents: agentEvents.length,
      eventTypes: eventTypes.size,
      recentEvents,
    }
  }

  const getHealthStatus = (lastSeen: string) => {
    const lastSeenDate = new Date(lastSeen)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    return lastSeenDate > fiveMinutesAgo
  }

  const getProgress = (agent: Agent) => {
    const isActive = getHealthStatus(agent.last_seen)
    const stats = getAgentStats(agent.agent_id)
    // Calculate progress based on activity (0-100)
    const progress = Math.min(100, (stats.recentEvents / 10) * 100)
    return isActive ? Math.max(progress, 20) : 0
  }

  if (loading) {
    return (
      <div className="bg-[#0F1629] border border-[#00D9FF]/20 rounded-2xl p-6">
        <p className="text-[#00D9FF]/60">Loading agents...</p>
      </div>
    )
  }

  const displayAgents = agents.slice(0, 4)

  return (
    <div className="bg-[#0F1629] border border-[#00D9FF]/20 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Active Agents</h2>
        <a href="#" className="text-sm text-[#00D9FF] hover:text-[#00FF88] transition-colors">View All</a>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {displayAgents.length === 0 ? (
          <div className="col-span-2 text-center text-[#00D9FF]/60 py-8">
            No agents registered
          </div>
        ) : (
          displayAgents.map((agent, index) => {
            const stats = getAgentStats(agent.agent_id)
            const isActive = getHealthStatus(agent.last_seen)
            const progress = getProgress(agent)

            return (
              <div
                key={agent.id}
                className={`${getProjectColor(index)} rounded-xl p-4 text-white border border-white/10`}
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm truncate">{agent.agent_id.substring(0, 20)}</h3>
                  {isActive && (
                    <div className="w-2 h-2 bg-[#00FF88] rounded-full animate-pulse"></div>
                  )}
                </div>
                <p className="text-xs text-white/80 mb-3 flex items-center">
                  <Clock className="w-3 h-3 mr-1" />
                  {formatDistanceToNow(new Date(agent.last_seen), { addSuffix: true })}
                </p>
                <div className="flex items-center justify-between mb-3 text-xs">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-1">
                      <Activity className="w-3 h-3" />
                      <span>{stats.recentEvents}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{stats.eventTypes}</span>
                    </div>
                  </div>
                  <div className="flex -space-x-1">
                    <div className="w-4 h-4 bg-white/30 rounded-full border border-white/50"></div>
                    <div className="w-4 h-4 bg-white/30 rounded-full border border-white/50"></div>
                    <div className="w-4 h-4 bg-white/30 rounded-full border border-white/50"></div>
                  </div>
                </div>
                <div className="w-full bg-white/20 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${isActive ? 'bg-white' : 'bg-white/50'
                      }`}
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

