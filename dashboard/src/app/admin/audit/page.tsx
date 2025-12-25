'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { AuditLogTable } from '@/components/AuditLogTable'
import { Shield } from 'lucide-react'

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
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin"></div>
                    <p className="text-slate-500 text-sm animate-pulse tracking-widest">VERIFYING CLEARANCE...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-purple-500/30">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden ml-64">
                <Header />
                <main className="flex-1 overflow-auto p-6 space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent flex items-center gap-2">
                                <Shield className="w-6 h-6 text-purple-500" />
                                Audit Ledger
                            </h1>
                            <p className="text-slate-400 text-sm mt-1">
                                Immutable record of all authority actions across the platform.
                            </p>
                        </div>
                    </div>

                    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 backdrop-blur-sm">
                        <AuditLogTable />
                    </div>
                </main>
            </div>
        </div>
    )
}
