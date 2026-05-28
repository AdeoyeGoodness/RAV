'use client'

import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import { TelemetryExplorer } from '@/components/TelemetryExplorer'
import { useAuth } from '@/contexts/AuthContext'

export default function TelemetryPage() {
    const { user, isLoading } = useAuth()

    if (isLoading || !user) {
        return (
            <div className="min-h-screen bg-[#020408] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen bg-[#020408] text-slate-200 font-sans selection:bg-cyan-500/30 overflow-hidden relative">
            {/* Global Ambient Background Effects */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[150px] rounded-full pointer-events-none mix-blend-screen" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 blur-[150px] rounded-full pointer-events-none mix-blend-screen" />

            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden ml-64 relative z-10">
                <Header />
                <ExpiryBanner />
                <ArchiveBanner />
                <main className="flex-1 overflow-auto p-8 space-y-6 mt-20">
                    {/* Page Header */}
                    <div>
                        <h1 className="text-2xl font-bold text-white">Telemetry Explorer</h1>
                        <p className="text-slate-400 text-sm mt-1">
                            Explore events across your organization
                        </p>
                    </div>

                    <TelemetryExplorer />
                </main>
            </div>
        </div>
    )
}
