'use client'

import { Activity, Shield, AlertTriangle, ScreenShare } from 'lucide-react'

interface StatsRowProps {
    stats: {
        agents: number
        events24h: number
        warnings: number
        uniqueIps: number
        screenshots: number
        criticalCount: number
        highCount: number
        mediumCount: number
        lowCount: number
    }
}

export function StatsRow({ stats }: StatsRowProps) {
    const totalAlerts = stats.criticalCount + stats.highCount + stats.mediumCount + stats.lowCount

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {/* Active Endpoints */}
            <div className="bg-[#131524]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/[0.08] shadow-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative z-10 flex flex-col h-full justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="text-4xl font-black text-white tracking-tighter drop-shadow-lg">{stats.agents}</div>
                            <span className="text-sm text-slate-400 font-medium tracking-wide">Active Endpoints</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between mt-6">
                        <div className="px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center gap-2 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
                            <ScreenShare className="w-4 h-4 text-cyan-400" />
                            <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                                {stats.agents > 0 ? 'All Healthy' : 'No Agents'}
                            </span>
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-white/5">
                        <button className="text-xs font-bold text-slate-400 hover:text-white transition-colors uppercase tracking-widest flex items-center gap-2 group/btn">
                            View Details
                            <span className="group-hover/btn:translate-x-1 transition-transform">→</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Events Last 24h */}
            <div className="bg-[#131524]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/[0.08] shadow-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative z-10 flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="text-3xl font-black text-white tracking-tight">{stats.events24h}</div>
                        <div className="flex flex-col">
                            <span className="text-sm text-slate-200 font-bold">Events</span>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Last 24h</span>
                        </div>
                    </div>

                    <div className="space-y-3 flex-1">
                        <div className="flex items-center gap-2 text-xs">
                            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
                            <span className="text-slate-300 font-medium">{stats.warnings} Warnings</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                            <Activity className="w-3.5 h-3.5 text-purple-400" />
                            <span className="text-slate-300 font-medium">{stats.uniqueIps} Unique IPs</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                            <ScreenShare className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-slate-300 font-medium">{stats.screenshots} Screenshots</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Investigations - Shows critical events */}
            <div className="bg-[#131524]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/[0.08] shadow-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="text-3xl font-black text-white tracking-tight">{stats.criticalCount + stats.highCount}</div>
                        <span className="text-sm text-slate-200 font-bold">Investigations</span>
                    </div>

                    <div className="space-y-4">
                        {stats.criticalCount > 0 && (
                            <div className="flex items-start gap-3 group/item">
                                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-slate-200">{stats.criticalCount} Critical Events</span>
                                        <span className="text-[9px] font-black bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded uppercase">Needs Review</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {stats.highCount > 0 && (
                            <div className="flex items-start gap-3 group/item">
                                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]" />
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-slate-200">{stats.highCount} High Priority</span>
                                        <span className="text-[9px] font-black bg-orange-500/10 text-orange-400 border border-orange-500/20 px-1.5 py-0.5 rounded uppercase">Pending</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {stats.criticalCount === 0 && stats.highCount === 0 && (
                            <div className="text-sm text-slate-500 italic">No investigations pending</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Pending Alerts - Severity Breakdown */}
            <div className="bg-[#131524]/80 backdrop-blur-xl rounded-3xl p-6 border border-white/[0.08] shadow-2xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative z-10 flex flex-col h-full">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="text-3xl font-black text-white tracking-tight">{totalAlerts}</div>
                        <span className="text-sm text-slate-200 font-bold">Pending Alerts</span>
                    </div>

                    <div className="space-y-3 flex-1 pt-2">
                        <div className="flex items-center gap-3">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                            <span className="text-xs font-bold text-slate-300">{stats.criticalCount} CRITICAL</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                            <span className="text-xs font-bold text-slate-300">{stats.highCount + stats.mediumCount} WARNING</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <Shield className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="text-xs font-bold text-slate-300">{stats.lowCount} INFO</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
