'use client'

import { User, ChevronRight, Shield, Clock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export function UserInsights() {
    const { user } = useAuth()

    const roleDisplay = user?.role?.replace('_', ' ') || 'User'
    const accessLevel = user?.role === 'super_admin' ? 'Full Platform Access' : 'Organization Scope'

    return (
        <div className="bg-[#0C0E1C]/90 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 h-full shadow-xl relative overflow-hidden">

            {/* User Profile */}
            <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center border border-white/[0.06]">
                    <User className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-slate-200 tracking-tight">Session Info</h3>
                    <p className="text-[10px] text-slate-600 font-mono">{user?.email || 'Unknown'}</p>
                </div>
            </div>

            {/* Session Details */}
            <div className="space-y-2.5">
                <div className="bg-[#080A14]/60 border border-white/[0.04] rounded-xl p-3.5">
                    <div className="text-[9px] uppercase font-medium text-slate-600 tracking-wider mb-1.5">Role</div>
                    <div className="flex items-center gap-2">
                        <Shield className="w-3 h-3 text-slate-500" />
                        <span className="text-xs font-medium text-slate-300 capitalize">{roleDisplay}</span>
                    </div>
                </div>

                <div className="bg-[#080A14]/60 border border-white/[0.04] rounded-xl p-3.5">
                    <div className="text-[9px] uppercase font-medium text-slate-600 tracking-wider mb-1.5">Access Scope</div>
                    <div className="flex items-center gap-2">
                        <ChevronRight className="w-3 h-3 text-slate-600" />
                        <span className="text-xs text-slate-400">{accessLevel}</span>
                    </div>
                </div>

                <div className="bg-[#080A14]/60 border border-white/[0.04] rounded-xl p-3.5">
                    <div className="text-[9px] uppercase font-medium text-slate-600 tracking-wider mb-1.5">Session</div>
                    <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-slate-600" />
                        <span className="text-xs text-slate-400">Active</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-auto" />
                    </div>
                </div>
            </div>
        </div>
    )
}
