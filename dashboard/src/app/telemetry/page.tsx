'use client'

import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { TelemetryExplorer } from '@/components/TelemetryExplorer'
import { Activity } from 'lucide-react'

export default function TelemetryPage() {
    return (
        <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden ml-64">
                <Header />
                <main className="flex-1 overflow-auto p-6 space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-600 bg-clip-text text-transparent flex items-center gap-2">
                                <Activity className="w-6 h-6 text-cyan-500" />
                                Telemetry Explorer
                            </h1>
                            <p className="text-slate-400 text-sm mt-1">
                                Real-time observation of platform events, process activity, and network signals.
                            </p>
                        </div>
                    </div>

                    <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-6 backdrop-blur-md shadow-2xl shadow-black/50 overflow-hidden relative">
                        {/* Glossy overlay effect */}
                        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
                        <TelemetryExplorer />
                    </div>
                </main>
            </div>
        </div>
    )
}
