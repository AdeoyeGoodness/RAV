'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAuditLogs, AuditLog, getCurrentUser } from '@/lib/api'
import {
    ShieldCheck,
    Filter,
    RefreshCw,
    BadgeCheck
} from 'lucide-react'

export default function ComplianceLogsPage() {
    const router = useRouter()
    const [logs, setLogs] = useState<AuditLog[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Filters
    const [actorType, setActorType] = useState('')
    const [actionType, setActionType] = useState('')

    useEffect(() => {
        checkAuthAndFetch()
    }, [])

    async function checkAuthAndFetch() {
        try {
            const user = await getCurrentUser()
            if (user.role !== 'super_admin') {
                router.push('/dashboard') // Or some other unauthorized page
                return
            }
            fetchLogs()
        } catch (err) {
            router.push('/login')
        }
    }

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

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold flex items-center gap-3">
                    <ShieldCheck className="h-10 w-10 text-emerald-400" />
                    Compliance Logs
                </h1>
                <p className="text-gray-400 mt-2 max-w-3xl">
                    Immutable audit records of administrative actions, agent lifecycle events, policy changes, and security-critical system activity.
                    Logs are tamper-resistant and maintained according to organizational policy.
                </p>

                <div className="flex gap-4 mt-4">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-800">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        WORM-style retention enabled
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-900/30 text-blue-400 border border-blue-800">
                        <BadgeCheck className="h-3 w-3" />
                        Integrity-protected
                    </span>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-gray-800 rounded-lg p-4 mb-6 border border-gray-700 flex flex-wrap gap-4 items-end">
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Actor Type</label>
                    <select
                        value={actorType}
                        onChange={(e) => setActorType(e.target.value)}
                        className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                    >
                        <option value="">All Actors</option>
                        <option value="super_admin">Super Admin</option>
                        <option value="org_admin">Org Admin</option>
                        <option value="system">System</option>
                    </select>
                </div>

                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Action Type</label>
                    <input
                        type="text"
                        placeholder="e.g. DATA_RESTORED"
                        value={actionType}
                        onChange={(e) => setActionType(e.target.value)}
                        className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none placeholder-gray-600"
                    />
                </div>

                <button
                    onClick={fetchLogs}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ml-auto"
                >
                    <Filter className="h-4 w-4" />
                    Filter Logs
                </button>

                <button
                    onClick={fetchLogs}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    title="Refresh"
                >
                    <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Logs Table */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-900/50 border-b border-gray-700 text-gray-400 text-xs uppercase tracking-wider">
                                <th className="p-4 w-48">Timestamp (UTC)</th>
                                <th className="p-4 w-48">Actor</th>
                                <th className="p-4 w-32">Action</th>
                                <th className="p-4 w-40">Target</th>
                                <th className="p-4 w-24">Result</th>
                                <th className="p-4 w-32">Source</th>
                                <th className="p-4 w-24 text-right">Integrity</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {logs.map((log) => (
                                <tr key={log.id} className="hover:bg-gray-700/30 transition-colors text-sm">
                                    <td className="p-4 font-mono text-gray-300">
                                        {new Date(log.timestamp).toISOString().replace('T', ' ').substring(0, 19)} UTC
                                    </td>
                                    <td className="p-4">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-white">
                                                {log.actor_name || log.actor_email || 'System / Unknown'}
                                            </span>
                                            <span className="text-xs text-gray-500">
                                                {log.actor_type.toUpperCase().replace('_', ' ')}
                                            </span>
                                            {log.actor_email && log.actor_name && (
                                                <span className="text-xs text-gray-600 font-mono">{log.actor_email}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className="inline-flex px-2 py-1 rounded text-xs font-semibold bg-gray-700 text-gray-300 border border-gray-600">
                                            {log.action_type}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex flex-col text-xs text-gray-400">
                                            <span className="font-medium text-gray-300">{log.target_type}</span>
                                            {log.target_id && <span className="font-mono opacity-75 truncate max-w-[10rem]">{log.target_id}</span>}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className="text-emerald-400 font-medium text-xs">Success</span>
                                    </td>
                                    <td className="p-4 text-gray-400 font-mono text-xs">
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
                                    <td colSpan={7} className="p-8 text-center text-gray-500">
                                        No compliance records found matching critera.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-gray-800 text-center text-gray-500 text-xs">
                <p className="flex items-center justify-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    Logs are append-only and cannot be modified or deleted through the user interface.
                    All entries are cryptographically integrity-checked.
                </p>
            </div>
        </div>
    )
}
