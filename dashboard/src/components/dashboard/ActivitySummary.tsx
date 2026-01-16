'use client'

import { Globe, Cpu, Chrome, FileCode } from 'lucide-react'

export function ActivitySummary() {
    return (
        <div className="bg-[#131524]/80 backdrop-blur-xl border border-white/[0.08] rounded-3xl p-8 relative overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <h3 className="text-base font-bold text-white tracking-tight">Timeline</h3>
                    <span className="text-xs font-medium text-slate-400 pt-0.5">- Last 30 Minutes</span>
                </div>
                <div className="flex gap-1.5 opacity-50">
                    <div className="w-1 h-4 bg-cyan-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.5)]" />
                    <div className="w-1 h-2.5 bg-slate-600 rounded-full" />
                    <div className="w-1 h-3 bg-slate-700 rounded-full" />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                {/* Network Activity - Blue Theme */}
                <div className="p-6 rounded-2xl bg-gradient-to-b from-[#111926] to-[#0E1016] border border-blue-500/10 hover:border-blue-500/30 transition-all group shadow-lg shadow-black/20">
                    <div className="flex items-center gap-4 mb-5">
                        <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 transition-colors shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                            <Globe className="w-5 h-5" />
                        </div>
                        <span className="text-sm font-bold text-slate-100">Network Activity</span>
                    </div>
                    <div className="space-y-3.5 mb-6 pl-1">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                            <span className="text-xs text-slate-300 font-medium">128 connections</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-blue-400/50" />
                            <span className="text-xs text-slate-400 font-medium">3 new external IPs</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-blue-900/50" />
                            <span className="text-xs text-slate-500 font-medium">1 unusual destination</span>
                        </div>
                    </div>
                    <button className="w-full py-2.5 bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 rounded-xl text-xs font-bold text-blue-400 transition-all uppercase tracking-wide">
                        View Details
                    </button>
                </div>

                {/* Process Activity - Emerald Theme */}
                <div className="p-6 rounded-2xl bg-gradient-to-b from-[#0F221C] to-[#0E1016] border border-emerald-500/10 hover:border-emerald-500/30 transition-all group shadow-lg shadow-black/20">
                    <div className="flex items-center gap-4 mb-5">
                        <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 transition-colors shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                            <Cpu className="w-5 h-5" />
                        </div>
                        <span className="text-sm font-bold text-slate-100">Process Activity</span>
                    </div>
                    <div className="space-y-3.5 mb-6 pl-1">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            <span className="text-xs text-slate-300 font-medium">15 processes started</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-400/50" />
                            <span className="text-xs text-slate-400 font-medium">2 unsigned binaries</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-900/50" />
                            <span className="text-xs text-slate-500 font-medium">WatchdogSvc launched</span>
                        </div>
                    </div>
                    <button className="w-full py-2.5 bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/10 rounded-xl text-xs font-bold text-emerald-400 transition-all uppercase tracking-wide">
                        View Details
                    </button>
                </div>

                {/* Browser Activity - Indigo Theme */}
                <div className="p-6 rounded-2xl bg-gradient-to-b from-[#151529] to-[#0E1016] border border-indigo-500/10 hover:border-indigo-500/30 transition-all group shadow-lg shadow-black/20">
                    <div className="flex items-center gap-4 mb-5">
                        <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500/20 transition-colors shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                            <Chrome className="w-5 h-5" />
                        </div>
                        <span className="text-sm font-bold text-slate-100">Browser Activity</span>
                    </div>
                    <div className="space-y-3.5 mb-6 pl-1">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                            <span className="text-xs text-slate-300 font-medium">76 URLs visited</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-indigo-400/50" />
                            <span className="text-xs text-slate-400 font-medium">2 policy violations</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-indigo-900/50" />
                            <span className="text-xs text-slate-500 font-medium">Blocked gambling site</span>
                        </div>
                    </div>
                    <button className="w-full py-2.5 bg-indigo-500/5 hover:bg-indigo-500/10 border border-indigo-500/10 rounded-xl text-xs font-bold text-indigo-400 transition-all uppercase tracking-wide">
                        View Details
                    </button>
                </div>

                {/* File Activity - Purple Theme */}
                <div className="p-6 rounded-2xl bg-gradient-to-b from-[#181226] to-[#0E1016] border border-purple-500/10 hover:border-purple-500/30 transition-all group shadow-lg shadow-black/20">
                    <div className="flex items-center gap-4 mb-5">
                        <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 group-hover:bg-purple-500/20 transition-colors shadow-[0_0_15px_rgba(168,85,247,0.1)]">
                            <FileCode className="w-5 h-5" />
                        </div>
                        <span className="text-sm font-bold text-slate-100">File Activity</span>
                    </div>
                    <div className="space-y-3.5 mb-6 pl-1">
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
                            <span className="text-xs text-slate-300 font-medium">23 files modified</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-purple-400/50" />
                            <span className="text-xs text-slate-400 font-medium">5 sensitive docs</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-purple-900/50" />
                            <span className="text-xs text-slate-500 font-medium">3 cloud uploads</span>
                        </div>
                    </div>
                    <button className="w-full py-2.5 bg-purple-500/5 hover:bg-purple-500/10 border border-purple-500/10 rounded-xl text-xs font-bold text-purple-400 transition-all uppercase tracking-wide">
                        View Details
                    </button>
                </div>
            </div>
        </div>
    )
}
