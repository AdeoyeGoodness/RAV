'use client'

import { User, Shield, Globe, Clock, Fingerprint } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export function UserInsights() {
    const { user } = useAuth()

    const roleDisplay = user?.role?.replace('_', ' ') || 'User'
    const accessLevel = user?.role === 'super_admin' ? 'Full Platform' : 'Organization'

    return (
        <div className="bg-[#080A14]/80 border border-white/[0.04] rounded-2xl p-6 h-full flex flex-col">
            {/* User Identity */}
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/10 to-violet-500/10 border border-white/[0.06] flex items-center justify-center">
                    <span className="text-sm font-bold text-sky-400">
                        {(user?.email?.charAt(0) || 'A').toUpperCase()}
                    </span>
                </div>
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-200 tracking-tight truncate">
                        {user?.email?.split('@')[0] || 'Administrator'}
                    </h3>
                    <p className="text-[10px] text-slate-600 font-mono truncate">{user?.email || 'Unknown'}</p>
                </div>
            </div>

            {/* Session Details */}
            <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.03]">
                    <div className="flex items-center gap-2.5">
                        <Shield className="w-3.5 h-3.5 text-sky-400/60" />
                        <span className="text-[11px] text-slate-500">Role</span>
                    </div>
                    <span className="text-[11px] font-medium text-slate-300 capitalize">{roleDisplay}</span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.03]">
                    <div className="flex items-center gap-2.5">
                        <Globe className="w-3.5 h-3.5 text-violet-400/60" />
                        <span className="text-[11px] text-slate-500">Scope</span>
                    </div>
                    <span className="text-[11px] font-medium text-slate-300">{accessLevel}</span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.03]">
                    <div className="flex items-center gap-2.5">
                        <Clock className="w-3.5 h-3.5 text-emerald-400/60" />
                        <span className="text-[11px] text-slate-500">Session</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-emerald-400">Active</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    </div>
                </div>

            </div>

            {/* Platform version */}
            <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between">
                <span className="text-[9px] text-slate-700 font-mono">RAV PLATFORM</span>
                <span className="text-[9px] text-slate-600 font-mono">v1.0.1</span>
            </div>
        </div>
    )
}
