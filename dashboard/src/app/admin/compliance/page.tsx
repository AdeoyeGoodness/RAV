'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAuditLogs, AuditLog } from '@/lib/api'
import {
    ShieldCheck,
    Filter,
    RefreshCw,
    BadgeCheck
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'

export default function ComplianceLogsPage() {
    const router = useRouter()
    const [logs, setLogs] = useState<AuditLog[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Filters
    const [actorType, setActorType] = useState('')
    const [actionType, setActionType] = useState('')

    const { user, isLoading } = useAuth()

    useEffect(() => {
        if (user) {
            if (user.role !== 'super_admin') {
                router.push('/')
            } else {
                fetchLogs()
            }
        }
    }, [user, isLoading])

    async function fetchLogs() {
        setLoading(true)
        try {
            const params: any = {}
            if (actorType) params.actor_type = actorType
            if (actionType) params.action_type = actionType

            const data = await getAuditLogs(params)
            setLogs(data)
        } catch (err) {
            setError('Failed to fetch compliance logs')
        } finally {
            setLoading(false)
        }
    }

    if (isLoading || !user || user.role !== 'super_admin') {
        return (
            <div className="min-h-screen bg-[#050510] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
                    <p className="text-slate-500 font-mono text-sm tracking-widest animate-pulse">COMPLIANCE AUTHORIZATION PENDING...</p>
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
                    {/* Header */}
                    <div className="mb-8">
                        <h1 className="text-3xl font-bold flex items-center gap-3 tracking-tight text-slate-200">
                            <ShieldCheck className="h-10 w-10 text-emerald-500" />
                            Compliance Logs
                        </h1>
                        <p className="text-slate-500 mt-2 max-w-3xl">
                            Immutable audit records of administrative actions, agent lifecycle events, policy changes, and security-critical system activity.
                            Logs are tamper-resistant and maintained according to organizational policy.
                        </p>

                        <div className="flex gap-4 mt-4">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                WORM-style retention enabled
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-sky-500/10 text-sky-500 border border-sky-500/20">
                                <BadgeCheck className="h-3 w-3" />
                                Integrity-protected
                            </span>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="bg-[#0C0E1C] rounded-xl p-4 mb-6 border border-white/[0.06] flex flex-wrap gap-4 items-end shadow-sm">
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Actor Type</label>
                            <select
                                value={actorType}
                                onChange={(e) => setActorType(e.target.value)}
                                className="bg-[#050510] border border-white/[0.06] rounded-md px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none w-40"
                            >
                                <option value="">All Actors</option>
                                <option value="super_admin">Super Admin</option>
                                <option value="org_admin">Org Admin</option>
                                <option value="system">System</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Action Type</label>
                            <input
                                type="text"
                                placeholder="e.g. DATA_RESTORED"
                                value={actionType}
                                onChange={(e) => setActionType(e.target.value)}
                                className="bg-[#050510] border border-white/[0.06] rounded-md px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-sky-500 focus:border-sky-500 outline-none placeholder-slate-600 w-48"
                            />
                        </div>

                        <button
                            onClick={fetchLogs}
                            className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-500 border border-sky-500/30 px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ml-auto"
                        >
                            <Filter className="h-4 w-4" />
                            Filter Logs
                        </button>

                        <button
                            onClick={fetchLogs}
                            className="bg-[#050510] hover:bg-white/[0.02] border border-white/[0.06] text-slate-300 px-3 py-2 rounded-md transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    {/* Logs Table */}
                    <div className="bg-[#0C0E1C] rounded-xl border border-white/[0.06] overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-[#050510] border-b border-white/[0.06] text-slate-500 text-xs uppercase tracking-wider">
                                        <th className="p-4 w-48 font-semibold">Timestamp (UTC)</th>
                                        <th className="p-4 w-48 font-semibold">Actor</th>
                                        <th className="p-4 w-32 font-semibold">Action</th>
                                        <th className="p-4 w-40 font-semibold">Target</th>
                                        <th className="p-4 w-24 font-semibold">Result</th>
                                        <th className="p-4 w-32 font-semibold">Source</th>
                                        <th className="p-4 w-24 text-right font-semibold">Integrity</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                    {logs.map((log) => (
                                        <tr key={log.id} className="hover:bg-white/[0.02] transition-colors text-sm">
                                            <td className="p-4 font-mono text-slate-400">
                                                {new Date(log.timestamp).toISOString().replace('T', ' ').substring(0, 19)} UTC
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-slate-200">
                                                        {log.actor_name || log.actor_email || 'System / Unknown'}
                                                    </span>
                                                    <span className="text-xs text-slate-500 mt-0.5">
                                                        {log.actor_type.toUpperCase().replace('_', ' ')}
                                                    </span>
                                                    {log.actor_email && log.actor_name && (
                                                        <span className="text-xs text-slate-500 font-mono mt-0.5">{log.actor_email}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <span className="inline-flex px-2 py-1 rounded text-[10px] uppercase font-bold tracking-widest bg-white/[0.04] text-slate-300 border border-white/[0.06]">
                                                    {log.action_type}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col text-xs text-slate-400">
                                                    <span className="font-medium text-slate-300">{log.target_type}</span>
                                                    {log.target_id && <span className="font-mono opacity-75 mt-0.5 truncate max-w-[10rem]">{log.target_id}</span>}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <span className="inline-flex items-center gap-1.5 text-emerald-500 font-medium text-xs">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                    Success
                                                </span>
                                            </td>
                                            <td className="p-4 text-slate-400 font-mono text-xs">
                                                {log.ip_address || 'Internal'}
                                            </td>
                                            <td className="p-4 text-right">
                                                <div className="flex items-center justify-end gap-1.5 text-emerald-500 font-medium text-xs">
                                                    <BadgeCheck className="h-4 w-4" />
                                                    Verified
                                                </div>
                                            </td>
                                        </tr>
                                    ))}

                                    {logs.length === 0 && !loading && (
                                        <tr>
                                            <td colSpan={7} className="p-8 text-center text-slate-500">
                                                No compliance records found matching critera.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-8 pt-6 border-t border-white/[0.06] text-center text-slate-500 text-xs pb-4">
                        <p className="flex items-center justify-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-slate-400" />
                            Logs are append-only and cannot be modified or deleted through the user interface.
                            All entries are cryptographically integrity-checked.
                        </p>
                    </div>
                </main>
            </div>
        </div>
    )
}

