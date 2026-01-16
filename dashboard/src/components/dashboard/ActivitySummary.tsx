'use client'

import { Globe, Cpu, Chrome, FileCode } from 'lucide-react'

export function ActivitySummary() {
    return (
        <div className="bg-[#12121A] border border-white/5 rounded-3xl p-6 relative overflow-hidden">
             <div className="flex items-center justify-between mb-6">
                 <div className="flex items-center gap-3">
                     <h3 className="text-sm font-bold text-slate-200">Timeline</h3>
                     <span className="text-xs text-slate-500">- Last 30 Minutes</span>
                 </div>
                 <div className="flex gap-1">
                     <div className="w-1 h-3 bg-cyan-500 rounded-full" />
                     <div className="w-1 h-2 bg-slate-700 rounded-full" />
                 </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                 {/* Network Activity */}
                 <div className="p-5 rounded-2xl bg-[#0A0A0F] border border-blue-500/10 hover:border-blue-500/30 transition-colors group">
                     <div className="flex items-center gap-3 mb-4">
                         <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 transition-colors">
                             <Globe className="w-4 h-4" />
                         </div>
                         <span className="text-sm font-bold text-slate-200">Network Activity</span>
                     </div>
                     <div className="space-y-3 mb-6 pl-1">
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                             <span className="text-xs text-slate-300 font-medium">128 connections</span>
                         </div>
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                             <span className="text-xs text-slate-300 font-medium">3 new external IPs</span>
                         </div>
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-blue-300" />
                             <span className="text-xs text-slate-300 font-medium">1 unusual destination</span>
                         </div>
                     </div>
                     <button className="w-full py-2 bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 rounded-lg text-xs font-bold text-blue-400 transition-colors">
                         View Details
                     </button>
                 </div>

                 {/* Process Activity */}
                 <div className="p-5 rounded-2xl bg-[#0A0A0F] border border-emerald-500/10 hover:border-emerald-500/30 transition-colors group">
                     <div className="flex items-center gap-3 mb-4">
                         <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 transition-colors">
                             <Cpu className="w-4 h-4" />
                         </div>
                         <span className="text-sm font-bold text-slate-200">Process Activity</span>
                     </div>
                     <div className="space-y-3 mb-6 pl-1">
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                             <span className="text-xs text-slate-300 font-medium">15 processes started</span>
                         </div>
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                             <span className="text-xs text-slate-300 font-medium">2 unsigned binaries</span>
                         </div>
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-emerald-300" />
                             <span className="text-xs text-slate-300 font-medium">WatchdogSvc launched</span>
                         </div>
                     </div>
                     <button className="w-full py-2 bg-emerald-500/5 hover:bg-emerald-500/10 border border-emerald-500/10 rounded-lg text-xs font-bold text-emerald-400 transition-colors">
                         View Details
                     </button>
                 </div>

                 {/* Browser Activity */}
                 <div className="p-5 rounded-2xl bg-[#0A0A0F] border border-indigo-500/10 hover:border-indigo-500/30 transition-colors group">
                     <div className="flex items-center gap-3 mb-4">
                         <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500/20 transition-colors">
                             <Chrome className="w-4 h-4" />
                         </div>
                         <span className="text-sm font-bold text-slate-200">Browser Activity</span>
                     </div>
                     <div className="space-y-3 mb-6 pl-1">
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                             <span className="text-xs text-slate-300 font-medium">76 URLs visited</span>
                         </div>
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                             <span className="text-xs text-slate-300 font-medium">2 policy violations</span>
                         </div>
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-indigo-300" />
                             <span className="text-xs text-slate-300 font-medium">Blocked gambling site</span>
                         </div>
                     </div>
                     <button className="w-full py-2 bg-indigo-500/5 hover:bg-indigo-500/10 border border-indigo-500/10 rounded-lg text-xs font-bold text-indigo-400 transition-colors">
                         View Details
                     </button>
                 </div>

                 {/* File Activity */}
                 <div className="p-5 rounded-2xl bg-[#0A0A0F] border border-purple-500/10 hover:border-purple-500/30 transition-colors group">
                     <div className="flex items-center gap-3 mb-4">
                         <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 group-hover:bg-purple-500/20 transition-colors">
                             <FileCode className="w-4 h-4" />
                         </div>
                         <span className="text-sm font-bold text-slate-200">File Activity</span>
                     </div>
                     <div className="space-y-3 mb-6 pl-1">
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                             <span className="text-xs text-slate-300 font-medium">23 files modified</span>
                         </div>
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                             <span className="text-xs text-slate-300 font-medium">5 sensitive docs</span>
                         </div>
                         <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-purple-300" />
                             <span className="text-xs text-slate-300 font-medium">3 cloud uploads</span>
                         </div>
                     </div>
                     <button className="w-full py-2 bg-purple-500/5 hover:bg-purple-500/10 border border-purple-500/10 rounded-lg text-xs font-bold text-purple-400 transition-colors">
                         View Details
                     </button>
                 </div>
             </div>
        </div>
    )
}
