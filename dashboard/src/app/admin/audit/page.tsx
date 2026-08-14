'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { AuditLogTable } from '@/components/AuditLogTable'
import { Panel, SectionHead } from '@/components/ct/primitives'

export default function AuditPage() {
    const router = useRouter()
    const { user, isLoading } = useAuth()

    useEffect(() => {
        if (!isLoading) {
            if (!user || user.role !== 'super_admin') {
                router.push('/')
            }
        }
    }, [user, isLoading])

    if (isLoading || !user || user.role !== 'super_admin') {
        return (
            <div className="min-h-screen bg-ct-bg flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 rounded-full animate-spin" style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }} />
                    <span className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.24em' }}>Verifying clearance</span>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden ml-64">
                <Header />
                <main className="flex-1 overflow-auto p-8 mt-20 space-y-6">
                    <SectionHead
                        eyebrow="Platform / Compliance"
                        title="Audit Ledger"
                    />
                    <p className="text-ct-ink3 text-[13px] -mt-2 max-w-3xl">
                        Immutable record of all authority actions across the platform.
                    </p>
                    <Panel>
                        <div className="p-6">
                            <AuditLogTable />
                        </div>
                    </Panel>
                </main>
            </div>
        </div>
    )
}
