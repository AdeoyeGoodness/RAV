'use client'

import { Search, Monitor, MoreHorizontal, Filter } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Agent } from '@/lib/api'

interface EnrolledAgentsProps {
    agents: Agent[]
}

export function EnrolledAgents({ agents }: EnrolledAgentsProps) {
    return (
        <div className="bg-[#12121A] border border-white/5 rounded-3xl p-6 relative overflow-hidden flex flex-col h-full">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold text-slate-200">Enrolled Agents</h3>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            placeholder="Search agents..."
                            className="bg-[#0A0A0F] border border-white/5 rounded-lg py-1.5 pl-9 pr-4 text-xs text-slate-300 placeholder:text-slate-600 focus:border-cyan-500/40 outline-none w-48"
                        />
                    </div>
                    <button className="p-1.5 bg-[#0A0A0F] border border-white/5 rounded-lg text-slate-400 hover:text-white transition-colors">
                        <Filter className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <div className="w-full overflow-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-white/5">
                            <th className="py-3 pl-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Agent ID</th>
                            <th className="py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Hostname</th>
                            <th className="py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">OS</th>
                            <th className="py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Last Active</th>
                            <th className="py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Notes</th>
                            <th className="py-3 pr-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {agents.slice(0, 5).map(agent => (
                            <tr key={agent.agent_id} className="group border-b border-white/[0.02] last:border-0 hover:bg-white/[0.02] transition-colors">
                                <td className="py-4 pl-2 text-xs font-mono text-slate-300">{agent.agent_id.substring(0, 12)}...</td>
                                <td className="py-4">
                                    <div className="flex items-center gap-2">
                                        <Monitor className="w-3.5 h-3.5 text-cyan-500" />
                                        <span className="text-xs font-medium text-slate-200">{agent.hostname}</span>
                                    </div>
                                </td>
                                <td className="py-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3.5 h-3.5 flex items-center justify-center">
                                            {/* Simple Windows Icon simulation */}
                                            <div className="grid grid-cols-2 gap-0.5">
                                                <div className="w-1.5 h-1.5 bg-blue-400" />
                                                <div className="w-1.5 h-1.5 bg-blue-400" />
                                                <div className="w-1.5 h-1.5 bg-blue-400" />
                                                <div className="w-1.5 h-1.5 bg-blue-400" />
                                            </div>
                                        </div>
                                        <span className="text-xs text-slate-400">Windows</span>
                                    </div>
                                </td>
                                <td className="py-4 text-xs text-slate-400 font-mono">
                                    {formatDistanceToNow(new Date(agent.last_seen), { addSuffix: true })}
                                </td>
                                <td className="py-4 text-xs text-slate-500 italic">Des Workstation</td>
                                <td className="py-4 pr-2 text-right">
                                    <button className="text-slate-600 hover:text-white transition-colors">
                                        <MoreHorizontal className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="mt-4 flex items-center justify-between">
                <button className="text-[10px] font-bold text-slate-400 hover:text-cyan-400 uppercase tracking-widest flex items-center gap-1 transition-colors">
                    More All Agents
                </button>
                <button className="px-3 py-1.5 bg-[#0A0A0F] border border-white/5 hover:border-white/10 rounded-lg text-xs font-medium text-slate-300 transition-colors">
                    View All Agents
                </button>
            </div>
        </div>
    )
}
