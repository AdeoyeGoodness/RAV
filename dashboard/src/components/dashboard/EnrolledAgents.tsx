'use client'

import { Search, Monitor, MoreHorizontal, Filter } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Agent } from '@/lib/api'

interface EnrolledAgentsProps {
    agents: Agent[]
}

export function EnrolledAgents({ agents }: EnrolledAgentsProps) {
    return (
        <div className="bg-[#131524]/80 backdrop-blur-xl border border-white/[0.08] rounded-3xl p-6 h-full flex flex-col shadow-2xl relative overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-bold text-white tracking-tight">Enrolled Agents</h3>
                <div className="flex items-center gap-2">
                    <div className="bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2 focus-within:border-cyan-500/50 transition-colors w-48">
                        <Search className="w-3.5 h-3.5 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search agents..."
                            className="bg-transparent border-none outline-none text-xs text-slate-200 placeholder:text-slate-600 w-full"
                        />
                    </div>
                    <button className="p-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-slate-400 transition-colors">
                        <Filter className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-white/5">
                            <th className="pb-4 pt-2 text-xs font-bold text-slate-500 uppercase tracking-wider pl-2">Agent ID</th>
                            <th className="pb-4 pt-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Hostname</th>
                            <th className="pb-4 pt-2 text-xs font-bold text-slate-500 uppercase tracking-wider">OS</th>
                            <th className="pb-4 pt-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Last Active</th>
                            <th className="pb-4 pt-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Notes</th>
                            <th className="pb-4 pt-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {agents.map((agent) => (
                            <tr key={agent.id} className="group border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                <td className="py-4 pl-2">
                                    <span className="font-mono text-xs text-slate-400 group-hover:text-cyan-400 transition-colors">
                                        {agent.agent_id.substring(0, 8)}...
                                    </span>
                                </td>
                                <td className="py-4">
                                    <div className="flex items-center gap-2">
                                        <Monitor className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-500 transition-colors" />
                                        <span className="text-sm font-bold text-slate-200 group-hover:text-white transition-colors">{agent.hostname || 'Unknown'}</span>
                                    </div>
                                </td>
                                <td className="py-4">
                                    <div className="flex items-center gap-2 text-xs text-slate-400">
                                        <div className="p-1 rounded bg-white/5">
                                            {/* Simple icon logic */}
                                            <div className="w-3 h-3 bg-blue-500/50 rounded-sm" />
                                        </div>
                                        <span>Windows</span>
                                    </div>
                                </td>
                                <td className="py-4 text-xs text-slate-400 font-mono tracking-tight">
                                    {formatDistanceToNow(new Date(agent.last_seen), { addSuffix: true })}
                                </td>
                                <td className="py-4 text-xs text-slate-500 italic">Des Workstation</td>
                                <td className="py-4 pr-2 text-right">
                                    <button className="p-1.5 rounded-lg hover:bg-white/10 text-slate-600 hover:text-white transition-colors">
                                        <MoreHorizontal className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {/* Placeholder rows if empty */}
                        {agents.length === 0 && [1, 2, 3].map(i => (
                            <tr key={i} className="border-b border-white/5 opacity-50">
                                <td className="py-4 pl-2 text-xs text-slate-700">DESKTOP-{i}9A</td>
                                <td className="py-4 text-sm text-slate-700">Waiting...</td>
                                <td className="py-4 text-xs text-slate-700">Windows</td>
                                <td className="py-4 text-xs text-slate-700">--</td>
                                <td className="py-4 text-xs text-slate-700">--</td>
                                <td className="py-4"></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-4 flex items-center justify-between pt-4 border-t border-white/5">
                <button className="text-xs font-bold text-slate-500 hover:text-white transition-colors flex items-center gap-1 group/btn">
                    More All Agents
                    <span className="group-hover/btn:translate-x-1 transition-transform">↓</span>
                </button>

                <button className="px-4 py-2 rounded-xl bg-[#0F111A] border border-white/10 hover:border-white/20 text-xs font-bold text-slate-300 hover:text-white transition-colors shadow-lg">
                    View All Agents
                </button>
            </div>
        </div>
    )
}
