'use client'

import { User, ChevronDown, ChevronRight, Info, Lock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export function UserInsights() {
    const { user } = useAuth()

    return (
        <div className="bg-[#131524]/80 backdrop-blur-xl border border-white/[0.08] rounded-3xl p-6 h-full shadow-2xl relative overflow-hidden">

            {/* User Profile */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 p-[1px]">
                        <div className="w-full h-full rounded-xl bg-[#131524] flex items-center justify-center overflow-hidden">
                            <User className="w-5 h-5 text-cyan-400" />
                        </div>
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white tracking-tight">User Insights</h3>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                            <span>{user?.full_name || user?.email || 'Unknown User'}</span>
                            <ChevronDown className="w-3 h-3" />
                        </div>
                    </div>
                </div>
                <button className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 transition-colors">
                    <Info className="w-4 h-4" />
                </button>
            </div>

            {/* Stats/Metrics */}
            <div className="space-y-3">
                <div className="bg-[#0A0B14]/50 border border-white/5 rounded-xl p-4">
                    <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">Role</div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white capitalize">{user?.role?.replace('_', ' ') || 'User'}</span>
                    </div>
                </div>

                <div className="bg-[#0A0B14]/50 border border-white/5 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">
                        <Lock className="w-3 h-3" />
                        Access Level
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                        <ChevronRight className="w-3 h-3 text-slate-600" />
                        <span>{user?.role === 'super_admin' ? 'Full Platform Access' : 'Organization Scope'}</span>
                    </div>
                </div>
            </div>

            <button className="w-full mt-6 py-3 rounded-xl bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 text-xs font-bold text-indigo-400 uppercase tracking-widest transition-all">
                View Full Activity
            </button>
        </div>
    )
}
