import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getAuditLogs, getOrgAuditLogs, getOrganizations, AuditLog, Organization } from '@/lib/api'
import { format } from 'date-fns'
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
            const params: any = {
                limit: 50,
                ...filters
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
            case 'super_admin': return <Shield className="w-4 h-4 text-purple-400" />
            case 'org_admin': return <User className="w-4 h-4 text-blue-400" />
            case 'system': return <Server className="w-4 h-4 text-gray-400" />
            default: return <User className="w-4 h-4 text-gray-400" />
        }
    }

    return (
        <div className="space-y-4">
            {/* Disclaimer / Trust Signal */}
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-md flex items-center gap-2 text-xs text-slate-400">
                <Shield className="w-4 h-4 text-green-500" />
                <span>AUDIT LEDGER IS IMMUTABLE. UPDATES ARE APPEND-ONLY.</span>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap gap-2 items-end bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                {/* Organization filter: super_admin only (the org_admin endpoint is already scoped
                    to their own org, so this dropdown is meaningless for them and we hide it). */}
                {user?.role === 'super_admin' && (
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-400">Organization</label>
                        <div className="relative">
                            <select
                                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 pl-8 text-sm text-slate-200 outline-none focus:border-purple-500 w-48 appearance-none"
                                value={filters.organization_id}
                                onChange={(e) => setFilters({ ...filters, organization_id: e.target.value })}
                            >
                                <option value="">All Organizations</option>
                                {orgs.map(org => (
                                    <option key={org.id} value={org.id}>{org.name}</option>
                                ))}
                            </select>
                            <Building2 className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Actor Type</label>
                    <select
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-purple-500"
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
                            // Org admins only care about their own admin actions in their ledger.
                            <>
                                <option value="">All Actions</option>
                                <option value="org_admin">Org Admin</option>
                            </>
                        )}
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Action Type</label>
                    {user?.role === 'super_admin' ? (
                        <input
                            type="text"
                            placeholder="e.g. ORG_CREATED"
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-purple-500"
                            value={filters.action_type}
                            onChange={(e) => setFilters({ ...filters, action_type: e.target.value })}
                        />
                    ) : (
                        // For org admins, expose the 5 destructive actions explicitly so they
                        // don't have to remember + spell the action_type strings.
                        <select
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-purple-500 min-w-[200px]"
                            value={filters.action_type}
                            onChange={(e) => setFilters({ ...filters, action_type: e.target.value })}
                        >
                            <option value="">All Actions</option>
                            <option value="AGENT_EVENTS_WIPED">Agent Events Wiped</option>
                            <option value="AGENT_DELETED">Agent Deleted</option>
                            <option value="AGENT_EVENTS_RESTORED">Agent Events Restored</option>
                            <option value="ARCHIVE_TRIGGERED">Archive Triggered</option>
                            <option value="ORG_ARCHIVE_TRIGGERED">Org Archive Triggered</option>
                            <option value="AGENT_ENROLLED">Agent Enrolled</option>
                        </select>
                    )}
                </div>

                {user?.role === 'super_admin' && (
                    <div className="flex flex-col gap-1">
                        <label className="text-xs text-slate-400">Target Type</label>
                        <input
                            type="text"
                            placeholder="e.g. AGENT"
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-purple-500"
                            value={filters.target_type}
                            onChange={(e) => setFilters({ ...filters, target_type: e.target.value })}
                        />
                    </div>
                )}

                <button
                    onClick={() => fetchLogs()}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm flex items-center gap-1 h-[30px]"
                >
                    <Search className="w-4 h-4" /> Filter
                </button>

                <div className="flex-1" />

                <button
                    onClick={handleExport}
                    className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded text-sm flex items-center gap-1 h-[30px]"
                >
                    <Download className="w-4 h-4" /> CSV Export
                </button>
            </div>

            {/* Table */}
            <div className="border border-slate-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-800 text-slate-400 font-medium">
                        <tr>
                            <th className="px-4 py-3 w-8"></th>
                            <th className="px-4 py-3">Timestamp (UTC)</th>
                            <th className="px-4 py-3">Actor</th>
                            <th className="px-4 py-3">Action</th>
                            <th className="px-4 py-3">Target</th>
                            <th className="px-4 py-3">IP Address</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                        {loading ? (
                            <tr><td colSpan={6} className="text-center py-8 text-slate-500">Loading ledger...</td></tr>
                        ) : logs.length === 0 ? (
                            <tr><td colSpan={6} className="text-center py-8 text-slate-500">No audit records found matching criteria.</td></tr>
                        ) : (
                            logs.map((log) => (
                                <>
                                    <tr
                                        key={log.id}
                                        className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                                        onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                                    >
                                        <td className="px-4 py-3 text-slate-500">
                                            {expandedRow === log.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-300">
                                            {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                {getActorIcon(log.actor_type)}
                                                <span className="capitalize text-slate-200">{log.actor_type.replace('_', ' ')}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`
                        px-2 py-0.5 rounded text-xs font-medium border
                        ${log.action_type.includes('DELETE') ? 'bg-red-900/30 text-red-400 border-red-800' :
                                                    log.action_type.includes('CREATE') ? 'bg-green-900/30 text-green-400 border-green-800' :
                                                        'bg-blue-900/30 text-blue-400 border-blue-800'}
                      `}>
                                                {log.action_type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-400">
                                            {log.target_type}: <span className="text-slate-300">{log.target_id?.substring(0, 8)}...</span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                                            {log.ip_address || '-'}
                                        </td>
                                    </tr>

                                    {/* Expanded Detail View */}
                                    {expandedRow === log.id && (
                                        <tr className="bg-slate-950/50">
                                            <td colSpan={6} className="px-4 py-4 border-t border-slate-800">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Metadata</h4>
                                                        <pre className="bg-black/50 p-2 rounded border border-slate-800 text-xs font-mono text-green-400 overflow-auto max-h-40">
                                                            {JSON.stringify(log.metadata, null, 2)}
                                                        </pre>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Technical Details</h4>
                                                        <div className="grid grid-cols-[100px_1fr] gap-y-1 text-xs">
                                                            <span className="text-slate-500">Record ID:</span>
                                                            <span className="font-mono text-slate-400">{log.id}</span>

                                                            <span className="text-slate-500">Full Target ID:</span>
                                                            <span className="font-mono text-slate-400">{log.target_id}</span>

                                                            <span className="text-slate-500">Actor ID:</span>
                                                            <span className="font-mono text-slate-400">{log.actor_id}</span>

                                                            <span className="text-slate-500">User Agent:</span>
                                                            <span className="text-slate-400 truncate">{log.user_agent || 'N/A'}</span>
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
