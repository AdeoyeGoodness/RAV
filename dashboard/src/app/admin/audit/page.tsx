'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { AuditLogTable } from '@/components/AuditLogTable'
import { Shield } from 'lucide-react'

export default function AuditPage() {
    const router = useRouter()
    const [authorized, setAuthorized] = useState(false)

    useEffect(() => {
        // Basic Client-side role check (Security layered on backend too)
        const token = localStorage.getItem('rav_token')

        // Parse JWT roughly to check role for immediate redirect
        // (Real verification happens on API calls)
        if (!token) {
            router.push('/login')
            return
        }

        try {
            const payload = JSON.parse(atob(token.split('.')[1]))
            if (payload.role !== 'super_admin') {
                router.push('/') // Redirect non-super-admins
                return
            }
            setAuthorized(true)
        } catch (e) {
            router.push('/login')
        }
    }, [router])

    if (!authorized) {
        return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">Verifying Authority...</div>
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
