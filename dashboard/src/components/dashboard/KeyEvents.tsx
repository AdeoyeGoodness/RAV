'use client'

import { AlertTriangle, AlertOctagon } from 'lucide-react'

export function KeyEvents() {
    return (
        <div className="bg-[#12121A] border border-white/5 rounded-3xl p-6 relative overflow-hidden flex flex-col h-full">
            <h3 className="text-sm font-bold text-slate-200 mb-6">Key Events</h3>

            <div className="space-y-6 flex-1 overflow-auto pr-2">
                <div className="relative pl-6 border-l border-white/5 space-y-6">
                    {/* Item 1 */}
                    <div className="relative">
                        <div className="absolute -left-[29px] top-1 w-3 h-3 rounded-full bg-red-500 border-2 border-[#12121A]" />
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-slate-200">Sensitive File Transfer</span>
                                <span className="text-[9px] font-black bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded uppercase">Detected</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                                3 mins ago • Laptop-A12 • <span className="bg-white/5 px-1 rounded text-slate-400">FILE_XFER</span>
                            </div>
                        </div>
                    </div>

                    {/* Item 2 */}
                    <div className="relative">
                        <div className="absolute -left-[29px] top-1 w-3 h-3 rounded-full bg-indigo-500 border-2 border-[#12121A]" />
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-200">OneDriveUpdater.exe</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                                3 mins ago • <span className="bg-white/5 px-1 rounded text-slate-400">MKDIR_EXT</span>
                            </div>
                        </div>
                    </div>

                    {/* Item 3 */}
                    <div className="relative">
                         <div className="absolute -left-[29px] top-1 w-3 h-3 rounded-full bg-yellow-500 border-2 border-[#12121A]" />
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-slate-200">Unsanctioned USB Usage</span>
                                <span className="text-[9px] font-black bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded uppercase">Detected</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                                Workstation-A17 • <span className="bg-white/5 px-1 rounded text-slate-400">USB_MOUNT</span>
                            </div>
                        </div>
                    </div>

                    {/* Item 4 */}
                    <div className="relative">
                        <div className="absolute -left-[29px] top-1 w-3 h-3 rounded-full bg-slate-500 border-2 border-[#12121A]" />
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-200">Games are running which...</span>
                            </div>
                             <div className="text-[10px] text-slate-500 font-mono">
                                1 hour ago • Brics vec • <span className="bg-white/5 px-1 rounded text-slate-400">PROC_START</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <button className="w-full mt-6 py-2 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-600/20 rounded-lg text-xs font-bold text-blue-400 transition-colors uppercase tracking-wide">
                View Full Activity
            </button>
        </div>
    )
}
