'use client'

import { formatDistanceToNow } from 'date-fns'

interface Agent {
  id: string
  agent_id: string
  hardware_fingerprint: string
  last_seen: string
  license_expiry: string | null
}

interface AgentStatusProps {
  agents: Agent[]
  loading: boolean
}

export default function AgentStatus({ agents, loading }: AgentStatusProps) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <p className="text-gray-500">Loading agents...</p>
      </div>
    )
  }

  const activeAgents = agents.filter((agent) => {
    const lastSeen = new Date(agent.last_seen)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    return lastSeen > fiveMinutesAgo
  })

  return (
    <div className="lg:col-span-3">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Agent Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded">
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Agents</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {agents.length}
            </p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded">
            <p className="text-sm text-gray-600 dark:text-gray-400">Active Agents</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {activeAgents.length}
            </p>
          </div>
        </div>

        {agents.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold mb-2">Recent Agents</h4>
            <div className="space-y-2">
              {agents.slice(0, 5).map((agent) => {
                const lastSeen = new Date(agent.last_seen)
                const isActive = lastSeen > new Date(Date.now() - 5 * 60 * 1000)
                
                return (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded"
                  >
                    <div>
                      <p className="text-sm font-medium">{agent.agent_id}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDistanceToNow(lastSeen, { addSuffix: true })}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        isActive
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

