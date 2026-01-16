'use client'

import { User } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export function UserInsights() {
    const { user } = useAuth()

    return (
        <div className="bg-[#12121A] border border-white/5 rounded-3xl p-6 relative overflow-hidden flex flex-col h-full">
            <div className="flex items-center gap-4 mb-6">
                 <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white font-bold shadow-lg">
                    <User className="w-5 h-5" />
                 </div>
                 <div>
                     <h3 className="text-sm font-bold text-white">User Insights</h3>
                     <p className="text-xs text-slate-500">Garch Sleice v</p>
                 </div>
            </div>

            <div className="space-y-4 flex-1">
                 <div className="p-3 bg-[#0A0A0F] border border-white/5 rounded-xl space-y-1">
                     <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Engineering Load</p>
                     <p className="text-xs font-mono text-slate-300">Histram cedaris x D7</p>
                 </div>

                 <div className="p-3 bg-[#0A0A0F] border border-white/5 rounded-xl space-y-2">
                     <div className="flex items-center gap-2">
                         <div className="w-1 h-3 bg-red-500 rounded-full" />
                         <p className="text-[10px] font-bold text-slate-500 uppercase">USB Access:</p>
                     </div>
                     <p className="text-xs font-mono text-slate-300 pl-3">
                         {'>'} Dovinleadltg _GRC, policy-docx
                     </p>
                 </div>
            </div>

            <button className="w-full mt-6 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-600/20 rounded-lg text-xs font-bold text-indigo-400 transition-colors uppercase tracking-wide">
                View Full Activity
            </button>
        </div>
    )
}
