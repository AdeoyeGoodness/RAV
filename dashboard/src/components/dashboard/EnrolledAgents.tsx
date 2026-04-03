'use client'

import { Search, Monitor, MoreHorizontal, Filter, Plus, Server } from 'lucide-react'
import { Agent } from '@/lib/api'
import Link from 'next/link'

interface EnrolledAgentsProps {
    agents: Agent[]
}

export function EnrolledAgents({ agents }: EnrolledAgentsProps) {
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

    return (
        <div className="bg-[#0C0E1C]/90 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 h-full flex flex-col shadow-xl relative overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-slate-200 tracking-tight">Enrolled Endpoints</h3>
                    <span className="text-[10px] font-mono text-slate-500 bg-white/[0.03] px-2 py-0.5 rounded border border-white/[0.06]">
                        {agents.length} {agents.length === 1 ? 'device' : 'devices'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="bg-[#080A14] border border-white/[0.06] rounded-lg px-3 py-1.5 flex items-center gap-2 focus-within:border-sky-500/30 transition-colors w-44">
                        <Search className="w-3 h-3 text-slate-600" />
                        <input
                            type="text"
                            placeholder="Filter endpoints..."
                            className="bg-transparent border-none outline-none text-xs text-slate-300 placeholder:text-slate-700 w-full"
                        />
                    </div>
                    <button className="p-1.5 rounded-lg border border-white/[0.06] hover:bg-white/[0.03] text-slate-500 transition-colors">
                        <Filter className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* Table or Empty State */}
            <div className="flex-1 overflow-auto">
                {agents.length > 0 ? (
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/[0.04]">
                                <th className="pb-3 pt-1 text-xs font-bold text-slate-600 uppercase tracking-widest pl-2">Endpoint</th>
                                <th className="pb-3 pt-1 text-xs font-bold text-slate-600 uppercase tracking-widest">Hostname</th>
                                <th className="pb-3 pt-1 text-xs font-bold text-slate-600 uppercase tracking-widest">Platform</th>
                                <th className="pb-3 pt-1 text-xs font-bold text-slate-600 uppercase tracking-widest">Status</th>
                                <th className="pb-3 pt-1 text-xs font-bold text-slate-600 uppercase tracking-widest">Last Seen</th>
                                <th className="pb-3 pt-1"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {agents.map((agent) => (
                                <tr key={agent.id} className="group border-b border-white/[0.03] hover:bg-white/[0.015] transition-colors">
                                    <td className="py-3.5 pl-2">
                                        <span className="font-mono text-xs text-slate-500 group-hover:text-slate-300 transition-colors">
                                            {agent.agent_id.substring(0, 10)}
                                        </span>
                                    </td>
                                    <td className="py-3.5">
                                        <div className="flex items-center gap-2.5">
                                            <Monitor className="w-4 h-4 text-slate-600" />
                                            <span className="text-sm font-semibold text-slate-300">{agent.hostname || 'Unknown'}</span>
                                        </div>
                                    </td>
                                    <td className="py-3.5">
                                        <span className="text-xs text-slate-500 bg-white/[0.03] px-2 py-0.5 rounded border border-white/[0.04]">Windows</span>
                                    </td>
                                    <td className="py-3.5">
                                        <div className="flex items-center gap-1.5">
                                            <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(agent)}`} />
                                            <span className="text-sm text-slate-400">{getStatusLabel(agent)}</span>
                                        </div>
                                    </td>
                                    <td className="py-3.5 text-xs text-slate-500 font-mono">
                                        {formatLastSeenServer(agent)}
                                    </td>
                                    <td className="py-3.5 pr-2 text-right">
                                        <Link href={`/devices/${agent.agent_id}`}>
                                            <button className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-600 hover:text-slate-300 transition-colors">
                                                <MoreHorizontal className="w-4 h-4" />
                                            </button>
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="w-12 h-12 rounded-xl bg-slate-800/50 border border-white/[0.04] flex items-center justify-center mb-4">
                            <Server className="w-5 h-5 text-slate-600" />
                        </div>
                        <p className="text-sm font-medium text-slate-400 mb-1">No endpoints enrolled</p>
                        <p className="text-xs text-slate-600 max-w-[280px]">
                            Deploy the RAV agent to begin monitoring. See the deployment guide for installation steps.
                        </p>
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-center justify-between pt-3 border-t border-white/[0.04]">
                <span className="text-[10px] text-slate-600 font-mono">
                    {agents.length > 0 ? `Showing ${agents.length} endpoint${agents.length !== 1 ? 's' : ''}` : 'Awaiting agent deployment'}
                </span>
                <Link href="/devices">
                    <button className="px-3.5 py-1.5 rounded-lg bg-[#0A0C16] border border-white/[0.06] hover:border-white/[0.12] text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors">
                        Manage Endpoints
                    </button>
                </Link>
            </div>
        </div>
    )
}
