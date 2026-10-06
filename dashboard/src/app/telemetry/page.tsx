'use client'

import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import NextArchiveBanner from '@/components/NextArchiveBanner'
import { TelemetryExplorer } from '@/components/TelemetryExplorer'
import { SectionHead } from '@/components/ct/primitives'
import { useAuth } from '@/contexts/AuthContext'

export default function TelemetryPage() {
    const { user, isLoading } = useAuth()

    if (isLoading || !user) {
        return (
            <div className="min-h-screen bg-ct-bg flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 rounded-full animate-spin" style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }} />
                    <span className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.24em' }}>Loading telemetry</span>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden ml-64">
                <Header />
                <ExpiryBanner />
                <ArchiveBanner />
                <NextArchiveBanner />
                <main className="flex-1 overflow-auto p-8 mt-20 space-y-6">
                    <SectionHead
                        eyebrow="Signals / Ledger"
                        title="Telemetry Explorer"
                    />
                    <TelemetryExplorer />
                </main>
            </div>
        </div>
    )
}
