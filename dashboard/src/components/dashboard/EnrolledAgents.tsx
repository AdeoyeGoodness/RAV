'use client'

import { Search, Monitor, MoreHorizontal, Filter, Server, ArrowUpRight, Wifi, WifiOff } from 'lucide-react'
import { Agent } from '@/lib/api'
import Link from 'next/link'
import { useState } from 'react'

interface EnrolledAgentsProps {
    agents: Agent[]
}

export function EnrolledAgents({ agents }: EnrolledAgentsProps) {
    const [filter, setFilter] = useState('')

    const getStatusColor = (agent: Agent) => {
        const msSinceLastSeen = agent.server_time_ms - agent.last_seen_ms;
        const diffMinutes = msSinceLastSeen / 60000
        if (diffMinutes < 5) return 'bg-emerald-500'
        if (diffMinutes < 30) return 'bg-amber-500'
        return 'bg-slate-600'
    }

    const getStatusLabel = (agent: Agent) => {
        const msSinceLastSeen = agent.server_time_ms - agent.last_seen_ms;
        const diffMinutes = msSinceLastSeen / 60000
        if (diffMinutes < 5) return 'Online'
        if (diffMinutes < 30) return 'Idle'
        return 'Offline'
    }

    const getStatusIcon = (agent: Agent) => {
        const msSinceLastSeen = agent.server_time_ms - agent.last_seen_ms;
        const diffMinutes = msSinceLastSeen / 60000
        if (diffMinutes < 30) return Wifi
        return WifiOff
    }

    const formatLastSeenServer = (agent: Agent) => {
        const diffMs = agent.server_time_ms - agent.last_seen_ms;
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMs / 3600000)
        const diffDays = Math.floor(diffMs / 86400000)

        if (diffMins < 1) return 'Just now'
        if (diffMins < 60) return `${diffMins}m ago`
        if (diffHours < 24) return `${diffHours}h ago`
        return `${diffDays}d ago`
    }

    const filtered = agents.filter(a =>
        !filter || (a.hostname || a.agent_id).toLowerCase().includes(filter.toLowerCase())
    )

    const onlineCount = agents.filter(a => {
        const diff = (a.server_time_ms - a.last_seen_ms) / 60000
        return diff < 5
    }).length

    return (
        <div className="bg-[#080A14]/80 border border-white/[0.04] rounded-2xl p-6 h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-slate-200 tracking-tight">Enrolled Endpoints</h3>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-600 bg-white/[0.03] px-2 py-0.5 rounded border border-white/[0.04]">
                            {agents.length} total
                        </span>
                        {onlineCount > 0 && (
                            <span className="text-[10px] font-mono text-emerald-400/70 bg-emerald-500/[0.06] px-2 py-0.5 rounded border border-emerald-500/[0.08]">
                                {onlineCount} online
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="bg-white/[0.02] border border-white/[0.05] rounded-lg px-3 py-1.5 flex items-center gap-2 focus-within:border-sky-500/20 transition-colors w-44">
                        <Search className="w-3 h-3 text-slate-700" />
                        <input
                            type="text"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder="Filter endpoints..."
                            className="bg-transparent border-none outline-none text-xs text-slate-300 placeholder:text-slate-700 w-full"
                        />
                    </div>
                </div>
            </div>

            {/* Table or Empty State */}
            <div className="flex-1 overflow-auto">
                {filtered.length > 0 ? (
                    <div className="space-y-1.5">
                        {filtered.map((agent) => {
                            const StatusIcon = getStatusIcon(agent)
                            return (
                                <Link key={agent.id} href={`/devices/${agent.agent_id}`}>
                                    <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.01] border border-white/[0.03] hover:border-white/[0.08] hover:bg-white/[0.02] transition-all group cursor-pointer">
                                        <div className="flex items-center gap-3.5">
                                            <div className="w-9 h-9 rounded-lg bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                                                <Monitor className="w-4 h-4 text-slate-500 group-hover:text-sky-400 transition-colors" />
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-slate-300 group-hover:text-slate-100 transition-colors">
                                                    {agent.hostname || 'Unknown Host'}
                                                </div>
                                                <div className="text-[10px] font-mono text-slate-700">
                                                    {agent.agent_id.substring(0, 12)}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-6">
                                            <span className="text-[10px] text-slate-600 bg-white/[0.02] px-2 py-0.5 rounded border border-white/[0.04]">
                                                Windows
                                            </span>

                                            <div className="flex items-center gap-1.5 w-16">
                                                <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(agent)}`} />
                                                <span className="text-[11px] text-slate-400">{getStatusLabel(agent)}</span>
                                            </div>

                                            <span className="text-[10px] font-mono text-slate-600 w-14 text-right">
                                                {formatLastSeenServer(agent)}
                                            </span>

                                            <ArrowUpRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-sky-400 transition-colors" />
                                        </div>
                                    </div>
                                </Link>
                            )
                        })}
                    </div>
                ) : agents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center mb-4">
                            <Server className="w-6 h-6 text-slate-700" />
                        </div>
                        <p className="text-sm font-medium text-slate-400 mb-1">No endpoints enrolled</p>
                        <p className="text-xs text-slate-600 max-w-[280px]">
                            Deploy the RAV agent to begin monitoring.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <p className="text-xs text-slate-500">No results for &ldquo;{filter}&rdquo;</p>
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-center justify-between pt-3 border-t border-white/[0.04]">
                <span className="text-[10px] text-slate-700 font-mono">
                    {agents.length > 0 ? `${filtered.length} of ${agents.length} shown` : 'Awaiting deployment'}
                </span>
                <Link href="/devices">
                    <button className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 hover:text-sky-400 transition-colors">
                        Manage Endpoints <ArrowUpRight className="w-3 h-3" />
                    </button>
                </Link>
            </div>
        </div>
    )
}
