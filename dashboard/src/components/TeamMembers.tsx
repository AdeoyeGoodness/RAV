'use client'

import { MessageCircle } from 'lucide-react'

interface Agent {
  id: string
  agent_id: string
  hardware_fingerprint: string
  last_seen: string
}

interface TeamMembersProps {
  agents: Agent[]
  loading: boolean
}

export default function TeamMembers({ agents, loading }: TeamMembersProps) {
  const getInitials = (name: string) => {
    return name.substring(0, 2).toUpperCase()
  }

  const getRole = (index: number) => {
    const roles = ['System Agent', 'Monitoring Agent', 'Forensics Agent', 'Security Agent']
    return roles[index % roles.length]
  }

  const getColor = (index: number) => {
    const colors = [
      'bg-gradient-to-br from-[#00D9FF] to-[#0066FF]',
      'bg-gradient-to-br from-[#6C5CE7] to-[#8B7ED8]',
      'bg-gradient-to-br from-[#00FF88] to-[#00D9FF]',
      'bg-gradient-to-br from-[#FF00E5] to-[#6C5CE7]',
    ]
    return colors[index % colors.length]
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
      <h2 className="text-lg font-semibold text-white mb-4">Active Agents</h2>
      <div className="space-y-3">
        {displayAgents.length === 0 ? (
          <p className="text-[#00D9FF]/60 text-sm">No agents registered</p>
        ) : (
          displayAgents.map((agent, index) => {
            const isActive = new Date(agent.last_seen) > new Date(Date.now() - 5 * 60 * 1000)
            return (
              <div key={agent.id} className="flex items-center justify-between p-3 hover:bg-[#1A1F3A] rounded-lg border border-[#00D9FF]/10 transition-all">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 ${getColor(index)} rounded-full flex items-center justify-center text-white font-semibold text-sm border-2 ${isActive ? 'border-[#00FF88]' : 'border-[#00D9FF]/30'}`}>
                    {getInitials(agent.agent_id)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{agent.agent_id.substring(0, 20)}</p>
                    <p className="text-xs text-[#00D9FF]/70">{getRole(index)}</p>
                  </div>
                </div>
                <button className="p-2 hover:bg-[#6C5CE7]/20 rounded-lg transition-colors">
                  <MessageCircle className="w-5 h-5 text-[#00D9FF]" />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

