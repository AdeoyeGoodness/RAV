'use client'

import { Activity, Shield, AlertTriangle, Monitor } from 'lucide-react'
import Link from 'next/link'

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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Active Endpoints */}
            <div className="bg-[#0C0E1C]/90 backdrop-blur-xl rounded-2xl p-5 border border-white/[0.06] shadow-xl relative overflow-hidden group hover:border-white/[0.1] transition-all">
                <div className="relative z-10 flex flex-col h-full justify-between">
                    <div>
                        <div className="flex items-baseline gap-2.5 mb-1">
                            <div className="text-4xl font-bold text-white tracking-tight tabular-nums">{stats.agents}</div>
                            <span className="text-sm text-slate-500 font-medium">Active Endpoints</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between mt-5">
                        <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${stats.agents > 0 ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                            <span className="text-xs font-medium text-slate-500">
                                {stats.agents > 0 ? 'Reporting' : 'Awaiting deployment'}
                            </span>
                        </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-white/[0.04]">
                        <Link href="/devices" className="text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5">
                            <Monitor className="w-3.5 h-3.5" />
                            <span>View endpoints</span>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Events Last 24h */}
            <div className="bg-[#0C0E1C]/90 backdrop-blur-xl rounded-2xl p-5 border border-white/[0.06] shadow-xl relative overflow-hidden group hover:border-white/[0.1] transition-all">
                <div className="relative z-10 flex flex-col h-full">
                    <div className="flex items-baseline gap-2.5 mb-4">
                        <div className="text-4xl font-bold text-white tracking-tight tabular-nums">{stats.events24h}</div>
                        <div className="flex flex-col">
                            <span className="text-sm text-slate-400 font-medium">Events</span>
                            <span className="text-[10px] text-slate-600 uppercase tracking-wider font-mono">24h window</span>
                        </div>
                    </div>

                    <div className="space-y-3 flex-1">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">Warnings</span>
                            <span className="text-slate-400 font-mono tabular-nums">{stats.warnings}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">Unique IPs</span>
                            <span className="text-slate-400 font-mono tabular-nums">{stats.uniqueIps}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">Screenshots</span>
                            <span className="text-slate-400 font-mono tabular-nums">{stats.screenshots}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Investigations */}
            <div className="bg-[#0C0E1C]/90 backdrop-blur-xl rounded-2xl p-5 border border-white/[0.06] shadow-xl relative overflow-hidden group hover:border-white/[0.1] transition-all">
                <div className="relative z-10">
                    <div className="flex items-baseline gap-2.5 mb-5">
                        <div className="text-4xl font-bold text-white tracking-tight tabular-nums">{stats.criticalCount + stats.highCount}</div>
                        <span className="text-sm text-slate-400 font-medium">Investigations</span>
                    </div>

                    <div className="space-y-4">
                        {stats.criticalCount > 0 && (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                    <span className="text-sm text-slate-400">{stats.criticalCount} Critical</span>
                                </div>
                                <span className="text-[10px] font-medium bg-rose-500/8 text-rose-400 border border-rose-500/15 px-1.5 py-0.5 rounded">REVIEW</span>
                            </div>
                        )}

                        {stats.highCount > 0 && (
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                    <span className="text-sm text-slate-400">{stats.highCount} High Priority</span>
                                </div>
                                <span className="text-[10px] font-medium bg-amber-500/8 text-amber-400 border border-amber-500/15 px-1.5 py-0.5 rounded">PENDING</span>
                            </div>
                        )}

                        {stats.criticalCount === 0 && stats.highCount === 0 && (
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                                <span className="text-sm text-slate-600">No active investigations</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
