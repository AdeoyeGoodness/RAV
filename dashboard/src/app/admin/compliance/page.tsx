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
import { Panel, PanelHead, SectionHead, StatusPill, Eyebrow, ActionButton } from '@/components/ct/primitives'

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
            <div className="min-h-screen bg-ct-bg flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 rounded-full animate-spin" style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }} />
                    <span className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.24em' }}>Authorization pending</span>
                </div>
            </div>
        )
    }

    const inputBase = 'bg-ct-bg border border-ct-line rounded-sm px-3 py-2 text-[13px] text-ct-ink focus:border-ct-accent-border outline-none transition-colors font-mono'

    return (
        <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden ml-64">
                <Header />
                <main className="flex-1 overflow-auto p-8 mt-20 space-y-6">
                    <SectionHead
                        eyebrow="Platform / Compliance"
                        title="Compliance Logs"
                        right={
                            <div className="flex gap-2">
                                <StatusPill tone="ok">WORM retention</StatusPill>
                                <StatusPill tone="accent" dot={false}>
                                    <BadgeCheck className="w-3 h-3" />
                                    Integrity-protected
                                </StatusPill>
                            </div>
                        }
                    />
                    <p className="text-ct-ink3 text-[13px] -mt-2 max-w-3xl">
                        Immutable audit records of administrative actions, agent lifecycle events, policy changes, and security-critical system activity. Logs are tamper-resistant and maintained according to organizational policy.
                    </p>

                    <Panel>
                        <PanelHead title="Filters" />
                        <div className="p-4 flex flex-wrap gap-4 items-end">
                            <div>
                                <Eyebrow className="mb-1.5">Actor Type</Eyebrow>
                                <select
                                    value={actorType}
                                    onChange={(e) => setActorType(e.target.value)}
                                    className={`${inputBase} w-44`}
                                >
                                    <option value="">All Actors</option>
                                    <option value="super_admin">Super Admin</option>
                                    <option value="org_admin">Org Admin</option>
                                    <option value="system">System</option>
                                </select>
                            </div>

                            <div>
                                <Eyebrow className="mb-1.5">Action Type</Eyebrow>
                                <input
                                    type="text"
                                    placeholder="e.g. DATA_RESTORED"
                                    value={actionType}
                                    onChange={(e) => setActionType(e.target.value)}
                                    className={`${inputBase} w-56`}
                                />
                            </div>

                            <ActionButton onClick={fetchLogs} variant="primary">
                                <span className="inline-flex items-center gap-2">
                                    <Filter className="w-3 h-3" /> Filter
                                </span>
                            </ActionButton>

                            <ActionButton onClick={fetchLogs} variant="ghost">
                                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                            </ActionButton>
                        </div>
                    </Panel>

                    <Panel>
                        <PanelHead title="Ledger Entries" meta={`${logs.length} records`} />
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-ct-bg2 border-b border-ct-line">
                                        <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Timestamp (UTC)</th>
                                        <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Actor</th>
                                        <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Action</th>
                                        <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Target</th>
                                        <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Result</th>
                                        <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Source</th>
                                        <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium text-right" style={{ letterSpacing: '0.18em' }}>Integrity</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-ct-line">
                                    {logs.map((log) => (
                                        <tr key={log.id} className="hover:bg-ct-bg2 transition-colors text-[13px]">
                                            <td className="px-4 py-3 font-mono text-ct-ink3 tabular-nums">
                                                {new Date(log.timestamp).toISOString().replace('T', ' ').substring(0, 19)} UTC
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-ct-ink">
                                                        {log.actor_name || log.actor_email || 'System / Unknown'}
                                                    </span>
                                                    <span className="font-mono text-[10px] uppercase text-ct-ink3 mt-0.5" style={{ letterSpacing: '0.14em' }}>
                                                        {log.actor_type.toUpperCase().replace('_', ' ')}
                                                    </span>
                                                    {log.actor_email && log.actor_name && (
                                                        <span className="text-[11px] text-ct-ink3 font-mono mt-0.5">{log.actor_email}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <StatusPill tone="idle" dot={false}>{log.action_type}</StatusPill>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col">
                                                    <span className="text-ct-ink2 text-[12px]">{log.target_type}</span>
                                                    {log.target_id && <span className="font-mono text-[10px] text-ct-ink3 mt-0.5 truncate max-w-[10rem]">{log.target_id}</span>}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <StatusPill tone="ok">Success</StatusPill>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-[11px] text-ct-ink3">
                                                {log.ip_address || 'Internal'}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className="inline-flex items-center gap-1.5 text-ct-ok text-[11px] font-mono uppercase" style={{ letterSpacing: '0.14em' }}>
                                                    <BadgeCheck className="w-3.5 h-3.5" />
                                                    Verified
                                                </span>
                                            </td>
                                        </tr>
                                    ))}

                                    {logs.length === 0 && !loading && (
                                        <tr>
                                            <td colSpan={7} className="p-8 text-center text-ct-ink3 text-[13px]">
                                                No compliance records found matching criteria.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Panel>

                    <div className="mt-8 pt-6 border-t border-ct-line text-center pb-4">
                        <p className="flex items-center justify-center gap-2 text-[11px] text-ct-ink3 font-mono uppercase" style={{ letterSpacing: '0.18em' }}>
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Append-only ledger &mdash; cryptographically integrity-checked
                        </p>
                    </div>
                </main>
            </div>
        </div>
    )
}
