import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getAuditLogs, getOrgAuditLogs, getOrganizations, AuditLog, Organization } from '@/lib/api'
import { formatWATPattern } from '@/lib/time'
import {
    Shield,
    User,
    Server,
    Search,
    Download,
    ChevronDown,
    ChevronRight,
    Building2
} from 'lucide-react'
import { Eyebrow, StatusPill, ActionButton } from '@/components/ct/primitives'

export function AuditLogTable() {
    const [logs, setLogs] = useState<AuditLog[]>([])
    const [orgs, setOrgs] = useState<Organization[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedRow, setExpandedRow] = useState<string | null>(null)

    // Filters
    const [filters, setFilters] = useState({
        organization_id: '',
        actor_type: '',
        action_type: '',
        target_type: '',
        start_time: '',
        end_time: ''
    })

    const { user } = useAuth()

    const fetchLogs = async () => {
        setLoading(true)
        try {
            // Strip empty-string filters before sending — axios preserves
            // them as `?action_type=&target_type=` and the backend then
            // filters `l.action_type = ''` which matches zero rows,
            // silently emptying the table for every user with the default
            // "All Actions" selection. Only send filters that actually
            // carry a value.
            const params: any = { limit: 50 }
            for (const [k, v] of Object.entries(filters)) {
                if (v !== '' && v != null) params[k] = v
            }
            if (user?.role === 'super_admin') {
                const data = await getAuditLogs(params)
                setLogs(data)
            } else {
                const data = await getOrgAuditLogs(params)
                setLogs(data)
            }
        } catch (err) {
            console.error('Failed to fetch audit logs:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (user) {
            if (user.role === 'super_admin') {
                getOrganizations().then(setOrgs).catch(console.error)
            }
            fetchLogs()
        }
    }, [user, filters])

    const handleExport = () => {
        // Basic CSV Export
        const headers = ['Timestamp', 'Actor', 'Action', 'Target', 'IP', 'Metadata']
        const csvContent = [
            headers.join(','),
            ...logs.map(log => [
                log.timestamp,
                `${log.actor_type}:${log.actor_id || 'System'}`,
                log.action_type,
                `${log.target_type}:${log.target_id || ''}`,
                log.ip_address || '',
                `"${JSON.stringify(log.metadata).replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `audit-logs-${new Date().toISOString()}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
    }

    const getActorIcon = (type: string) => {
        switch (type) {
            case 'super_admin': return <Shield className="w-3.5 h-3.5 text-ct-accent" />
            case 'org_admin': return <User className="w-3.5 h-3.5 text-ct-accent" />
            case 'system': return <Server className="w-3.5 h-3.5 text-ct-ink3" />
            default: return <User className="w-3.5 h-3.5 text-ct-ink3" />
        }
    }

    const getActionTone = (action: string): 'crit' | 'ok' | 'accent' => {
        if (action.includes('DELETE') || action.includes('WIPE')) return 'crit'
        if (action.includes('CREATE') || action.includes('RESTORE')) return 'ok'
        return 'accent'
    }

    const inputBase = 'bg-ct-bg2 border border-ct-line rounded-sm px-2 py-1.5 text-[12px] text-ct-ink font-mono focus:border-ct-accent-border outline-none transition-colors'

    return (
        <div className="space-y-4">
            {/* Trust Signal */}
            <div
                className="p-3 rounded-sm flex items-center gap-2 border"
                style={{ background: 'var(--ct-bg2)', borderColor: 'var(--ct-line)' }}
            >
                <Shield className="w-3.5 h-3.5 text-ct-ok" />
                <Eyebrow>Audit Ledger is immutable / append-only</Eyebrow>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap gap-3 items-end p-4 rounded-sm bg-ct-bg2 border border-ct-line">
                {user?.role === 'super_admin' && (
                    <div className="flex flex-col gap-1">
                        <Eyebrow>Organization</Eyebrow>
                        <div className="relative">
                            <select
                                className={inputBase + ' pl-8 w-48 appearance-none'}
                                value={filters.organization_id}
                                onChange={(e) => setFilters({ ...filters, organization_id: e.target.value })}
                            >
                                <option value="">All Organizations</option>
                                {orgs.map(org => (
                                    <option key={org.id} value={org.id}>{org.name}</option>
                                ))}
                            </select>
                            <Building2 className="w-3.5 h-3.5 text-ct-ink3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <Eyebrow>Actor Type</Eyebrow>
                    <select
                        className={inputBase + ' w-40'}
                        value={filters.actor_type}
                        onChange={(e) => setFilters({ ...filters, actor_type: e.target.value })}
                    >
                        {user?.role === 'super_admin' ? (
                            <>
                                <option value="">All Actors</option>
                                <option value="super_admin">Super Admin</option>
                                <option value="org_admin">Org Admin</option>
                                <option value="system">System</option>
                            </>
                        ) : (
                            <>
                                <option value="">All Actions</option>
                                <option value="org_admin">Org Admin</option>
                            </>
                        )}
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <Eyebrow>Action Type</Eyebrow>
                    {user?.role === 'super_admin' ? (
                        <input
                            type="text"
                            placeholder="e.g. ORG_CREATED"
                            className={inputBase + ' w-48'}
                            value={filters.action_type}
                            onChange={(e) => setFilters({ ...filters, action_type: e.target.value })}
                        />
                    ) : (
                        <select
                            className={inputBase + ' min-w-[220px]'}
                            value={filters.action_type}
                            onChange={(e) => setFilters({ ...filters, action_type: e.target.value })}
                        >
                            <option value="">All Actions</option>
                            <optgroup label="Auth / session">
                                <option value="USER_LOGIN">User Login</option>
                                <option value="USER_LOGIN_FAILED">User Login Failed</option>
                                <option value="USER_PASSWORD_CHANGED">Password Changed</option>
                            </optgroup>
                            <optgroup label="User management">
                                <option value="USER_CREATED">User Created</option>
                                <option value="USER_SUSPENDED">User Suspended</option>
                                <option value="USER_ACTIVATED">User Activated</option>
                                <option value="USER_PASSWORD_RESET">User Password Reset</option>
                                <option value="USER_DELETED">User Deleted</option>
                            </optgroup>
                            <optgroup label="Endpoints">
                                <option value="AGENT_ENROLLED">Agent Enrolled</option>
                                <option value="AGENT_RENAMED">Agent Renamed</option>
                                <option value="AGENT_EVENTS_WIPED">Agent Events Wiped</option>
                                <option value="AGENT_EVENTS_RESTORED">Agent Events Restored</option>
                                <option value="AGENT_DELETED">Agent Deleted</option>
                            </optgroup>
                            <optgroup label="Enrollment tokens">
                                <option value="TOKEN_CREATED">Token Created</option>
                                <option value="TOKEN_REVOKED">Token Revoked</option>
                            </optgroup>
                            <optgroup label="Forensic vault">
                                <option value="ARCHIVE_TRIGGERED">Archive Triggered</option>
                                <option value="ORG_ARCHIVE_TRIGGERED">Org Archive Triggered</option>
                                <option value="BUNDLE_DOWNLOADED">Bundle Downloaded</option>
                            </optgroup>
                            <optgroup label="OCR keywords">
                                <option value="KEYWORD_ADDED">Keyword Added</option>
                                <option value="KEYWORD_DELETED">Keyword Deleted</option>
                            </optgroup>
                            <optgroup label="Organisation">
                                <option value="ORG_SETTINGS_UPDATED">Org Settings Updated</option>
                            </optgroup>
                        </select>
                    )}
                </div>

                {user?.role === 'super_admin' && (
                    <div className="flex flex-col gap-1">
                        <Eyebrow>Target Type</Eyebrow>
                        <input
                            type="text"
                            placeholder="e.g. AGENT"
                            className={inputBase + ' w-40'}
                            value={filters.target_type}
                            onChange={(e) => setFilters({ ...filters, target_type: e.target.value })}
                        />
                    </div>
                )}

                <ActionButton onClick={() => fetchLogs()} variant="primary">
                    <span className="inline-flex items-center gap-2">
                        <Search className="w-3 h-3" /> Filter
                    </span>
                </ActionButton>

                <div className="flex-1" />

                <ActionButton onClick={handleExport} variant="ghost">
                    <span className="inline-flex items-center gap-2">
                        <Download className="w-3 h-3" /> CSV Export
                    </span>
                </ActionButton>
            </div>

            {/* Table */}
            <div className="border border-ct-line rounded-sm overflow-hidden">
                <table className="w-full text-[13px] text-left">
                    <thead className="bg-ct-bg2 border-b border-ct-line">
                        <tr>
                            <th className="px-4 py-3 w-8"></th>
                            <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Timestamp (UTC)</th>
                            <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Actor</th>
                            <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Email</th>
                            <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Action</th>
                            <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Target</th>
                            <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>IP Address</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ct-line bg-ct-panel">
                        {loading ? (
                            <tr><td colSpan={7} className="text-center py-8 text-ct-ink3 text-[12px] font-mono uppercase" style={{ letterSpacing: '0.18em' }}>Loading ledger…</td></tr>
                        ) : logs.length === 0 ? (
                            <tr><td colSpan={7} className="text-center py-8 text-ct-ink3 text-[13px]">No audit records found matching criteria.</td></tr>
                        ) : (
                            logs.map((log) => (
                                <>
                                    <tr
                                        key={log.id}
                                        className="hover:bg-ct-bg2 cursor-pointer transition-colors"
                                        onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                                    >
                                        <td className="px-4 py-3 text-ct-ink3">
                                            {expandedRow === log.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-ct-ink2 tabular-nums">
                                            {formatWATPattern(log.timestamp, 'yyyy-MM-dd HH:mm:ss')}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                {getActorIcon(log.actor_type)}
                                                <span className="capitalize text-ct-ink">{log.actor_type.replace('_', ' ')}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-[11px] text-ct-ink2 truncate max-w-[220px]">
                                            {log.actor_email || <span className="text-ct-ink4">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <StatusPill tone={getActionTone(log.action_type)} dot={false}>
                                                {log.action_type}
                                            </StatusPill>
                                        </td>
                                        <td className="px-4 py-3 text-ct-ink2">
                                            {log.target_type}: <span className="text-ct-ink font-mono">{log.target_id?.substring(0, 8)}…</span>
                                        </td>
                                        <td className="px-4 py-3 text-ct-ink3 font-mono text-[11px]">
                                            {log.ip_address || '-'}
                                        </td>
                                    </tr>

                                    {expandedRow === log.id && (
                                        <tr className="bg-ct-bg2">
                                            <td colSpan={7} className="px-4 py-4 border-t border-ct-line">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <Eyebrow className="mb-2">Metadata</Eyebrow>
                                                        <pre className="bg-ct-bg p-3 rounded-sm border border-ct-line text-[11px] font-mono text-ct-ok overflow-auto max-h-40">
                                                            {JSON.stringify(log.metadata, null, 2)}
                                                        </pre>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Eyebrow>Technical Details</Eyebrow>
                                                        <div className="grid grid-cols-[110px_1fr] gap-y-1 text-[11px]">
                                                            <span className="text-ct-ink3">Record ID:</span>
                                                            <span className="font-mono text-ct-ink2">{log.id}</span>

                                                            <span className="text-ct-ink3">Full Target ID:</span>
                                                            <span className="font-mono text-ct-ink2">{log.target_id}</span>

                                                            <span className="text-ct-ink3">Actor ID:</span>
                                                            <span className="font-mono text-ct-ink2">{log.actor_id}</span>

                                                            <span className="text-ct-ink3">User Agent:</span>
                                                            <span className="text-ct-ink2 truncate">{log.user_agent || 'N/A'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
