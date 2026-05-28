'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { AuditLogTable } from '@/components/AuditLogTable'
import { Shield } from 'lucide-react'

// Org-scoped audit page (super_admins keep using /admin/audit for the cross-org ledger).
// The AuditLogTable component already detects the user role and switches the API call
// to /api/v1/org/audits, so we just render it here.
export default function OrgAuditPage() {
    const router = useRouter()
    const { user, isLoading } = useAuth()

    useEffect(() => {
        if (!isLoading) {
            if (!user || (user.role !== 'org_admin' && user.role !== 'super_admin')) {
                router.push('/')
            }
        }
    }, [user, isLoading, router])

    if (isLoading || !user || (user.role !== 'org_admin' && user.role !== 'super_admin')) {
        return (
            <div className="min-h-screen bg-[#050510] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
                    <p className="text-slate-500 text-sm animate-pulse tracking-widest font-semibold">LOADING AUDIT TRAIL...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen bg-[#050510] text-slate-200 font-sans selection:bg-sky-500/30">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden">
                <Header />
                <main className="flex-1 overflow-auto p-8 mt-20 space-y-6 ml-64">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-slate-200 flex items-center gap-2">
                                <Shield className="w-6 h-6 text-sky-500" />
                                Audit Trail
                            </h1>
                            <p className="text-slate-500 text-sm mt-1">
                                Every action performed against your organization&apos;s devices and data &mdash; wipes, restores, archive triggers, and more.
                            </p>
                        </div>
                    </div>

                    <div className="bg-[#0C0E1C] border border-white/[0.06] rounded-xl p-6 shadow-sm">
                        <AuditLogTable />
                    </div>
                </main>
            </div>
        </div>
    )
}
