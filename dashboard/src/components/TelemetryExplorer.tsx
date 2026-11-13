import { useState, useEffect, useMemo } from 'react'
import { getEvents, getAgents, Event, Agent } from '@/lib/api'
import { isToday, isYesterday, parseISO, subHours, subDays } from 'date-fns'
import { formatWATPattern } from '@/lib/time'
import { eventServerTime, formatSkew } from '@/lib/eventTime'
import {
    Monitor,
    ChevronDown,
    ChevronRight,
    ChevronLeft,
    Download,
    Globe,
    Cpu,
    FileText,
    Shield,
    Activity
} from 'lucide-react'
import { Panel, PanelHead, Eyebrow, ActionButton, StatusPill } from '@/components/ct/primitives'

export function TelemetryExplorer({ initialAgentId }: { initialAgentId?: string }) {
    const [events, setEvents] = useState<Event[]>([])
    const [agents, setAgents] = useState<Agent[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedRow, setExpandedRow] = useState<string | null>(null)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
    const [currentPage, setCurrentPage] = useState(1)
    const eventsPerPage = 30

    const [filters, setFilters] = useState({
        agent_id: initialAgentId || '',
        timeRange: '24h',
        category: '',
        severity: ''
    })

    useEffect(() => {
        getAgents().then(setAgents).catch(console.error)
    }, [])

    useEffect(() => {
        fetchEvents()
    }, [filters.agent_id, filters.category, filters.severity, filters.timeRange])

    const fetchEvents = async () => {
        setLoading(true)
        try {
            const cleanFilters: any = { limit: 500 }
            if (filters.agent_id) cleanFilters.agent_id = filters.agent_id
            if (filters.category) cleanFilters.category = filters.category
            if (filters.severity) cleanFilters.severity = filters.severity

            const now = new Date()
            switch (filters.timeRange) {
                case '1h':
                    cleanFilters.start_time = subHours(now, 1).toISOString()
                    break
                case '24h':
                    cleanFilters.start_time = subHours(now, 24).toISOString()
                    break
                case '7d':
                    cleanFilters.start_time = subDays(now, 7).toISOString()
                    break
                case '30d':
                    cleanFilters.start_time = subDays(now, 30).toISOString()
                    break
            }

            const data = await getEvents(cleanFilters)
            setEvents(data)
            setCurrentPage(1)
            setCollapsedGroups(new Set())
        } catch (error) {
            console.error('Failed to fetch telemetry', error)
        } finally {
            setLoading(false)
        }
    }

    const exportToCSV = () => {
        if (events.length === 0) return

        // Forensic export carries BOTH clocks: the authoritative server-received
        // time, the endpoint's own reported time, and the divergence between them.
        const headers = ['Server Received Time', 'Endpoint Reported Time', 'Clock Skew', 'Agent ID', 'Hostname', 'Event Type', 'Category', 'Severity', 'Metadata']

        const rows = events.map(event => {
            const agent = agents.find(a => a.agent_id === event.agent_id)
            return [
                eventServerTime(event),
                event.timestamp,
                formatSkew(event) || 'in sync',
                event.agent_id,
                agent?.hostname || 'Unknown',
                event.event_type,
                event.category,
                event.severity,
                JSON.stringify(event.metadata || {})
            ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')
        })

        const csv = [headers.join(','), ...rows].join('\n')

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute('download', `telemetry_export_${formatWATPattern(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`)
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const totalPages = Math.ceil(events.length / eventsPerPage)
    const paginatedEvents = useMemo(() => {
        const start = (currentPage - 1) * eventsPerPage
        const end = start + eventsPerPage
        return events.slice(start, end)
    }, [events, currentPage])

    const groupedEvents = useMemo(() => {
        const groups: { [key: string]: Event[] } = {}

        paginatedEvents.forEach(event => {
            const date = parseISO(eventServerTime(event) ?? event.timestamp)
            let dateKey: string

            if (isToday(date)) {
                dateKey = 'Today'
            } else if (isYesterday(date)) {
                dateKey = 'Yesterday'
            } else {
                dateKey = formatWATPattern(date, 'MMMM d, yyyy')
            }

            if (!groups[dateKey]) groups[dateKey] = []
            groups[dateKey].push(event)
        })

        return groups
    }, [paginatedEvents])

    const toggleGroup = (groupName: string) => {
        setCollapsedGroups(prev => {
            const newSet = new Set(prev)
            if (newSet.has(groupName)) {
                newSet.delete(groupName)
            } else {
                newSet.add(groupName)
            }
            return newSet
        })
    }

    const selectedAgent = agents.find(a => a.agent_id === filters.agent_id)
    const agentDisplayName = selectedAgent?.hostname || (filters.agent_id ? filters.agent_id.substring(0, 12) : 'All Endpoints')

    const getSeverityTone = (sev: string): 'crit' | 'warn' | 'accent' | 'idle' => {
        switch (sev) {
            case 'critical': return 'crit'
            case 'high': return 'crit'
            case 'medium': return 'warn'
            case 'low': return 'accent'
            default: return 'idle'
        }
    }

    const getCategoryIcon = (cat: string) => {
        switch (cat) {
            case 'network': return <Globe className="w-3.5 h-3.5" />
            case 'process': return <Cpu className="w-3.5 h-3.5" />
            case 'file': return <FileText className="w-3.5 h-3.5" />
            case 'security': return <Shield className="w-3.5 h-3.5" />
            default: return <Activity className="w-3.5 h-3.5" />
        }
    }

    const getEventDescription = (event: Event) => {
        const meta = event.metadata || {}

        if (event.event_type === 'NETWORK_CONNECTION') {
            return (
                <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-ct-ink2">Network connection</span>
                    {meta.remote_ip && (
                        <span className="text-ct-accent font-mono text-[11px] px-1.5 py-0.5 rounded-sm border border-ct-accent-border" style={{ background: 'var(--ct-accent-soft)' }}>
                            {meta.remote_ip}
                        </span>
                    )}
                    {meta.process_name && (
                        <span className="text-ct-ink2 font-mono text-[11px] px-1.5 py-0.5 rounded-sm border border-ct-line" style={{ background: 'var(--ct-bg2)' }}>
                            {meta.process_name}
                        </span>
                    )}
                </span>
            )
        }

        if (event.event_type === 'USB_DEVICE_CONNECTED') {
            return (
                <span className="flex items-center gap-2">
                    <span className="text-ct-ink2">USB device connected</span>
                    {meta.device_name && <span className="text-ct-ink3">— {meta.device_name}</span>}
                </span>
            )
        }

        if (event.event_type === 'SCREENSHOT_TAKEN') {
            return (
                <span className="flex items-center gap-2">
                    <span className="text-ct-ink2">Screenshot captured</span>
                </span>
            )
        }

        if (event.event_type?.includes('BROWSER')) {
            return (
                <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-ct-ink2">Browser activity</span>
                    {meta.url && <span className="text-ct-ink3 truncate max-w-[200px] font-mono text-[11px]">{meta.url}</span>}
                </span>
            )
        }

        if (event.event_type?.includes('FILE')) {
            return (
                <span className="flex items-center gap-2">
                    <span className="text-ct-ink2">File activity</span>
                    {meta.file_path && <span className="text-ct-ink3 truncate max-w-[150px] font-mono text-[11px]">{meta.file_path}</span>}
                </span>
            )
        }

        if (event.event_type?.includes('PROCESS')) {
            return (
                <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-ct-ink2">{meta.process_name || 'Process activity'}</span>
                </span>
            )
        }

        return <span className="text-ct-ink3">{event.event_type?.replace(/_/g, ' ').toLowerCase()}</span>
    }

    const getPageNumbers = () => {
        const pages: (number | string)[] = []
        if (totalPages <= 5) {
            for (let i = 1; i <= totalPages; i++) pages.push(i)
        } else {
            if (currentPage <= 3) {
                pages.push(1, 2, 3, '...', totalPages)
            } else if (currentPage >= totalPages - 2) {
                pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages)
            } else {
                pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
            }
        }
        return pages
    }

    const selectBase = 'bg-ct-bg2 border border-ct-line rounded-sm px-3 py-2 text-[12px] text-ct-ink font-mono focus:border-ct-accent-border outline-none transition-colors cursor-pointer'

    return (
        <div className="space-y-5">
            {/* Filter Bar */}
            <Panel>
                <div className="p-4 flex items-center gap-3 flex-wrap">
                    <div className="relative">
                        <select
                            className={selectBase + ' pl-9 w-52 appearance-none'}
                            value={filters.agent_id}
                            onChange={(e) => setFilters({ ...filters, agent_id: e.target.value })}
                        >
                            <option value="">All Endpoints</option>
                            {agents.map(agent => (
                                <option key={agent.agent_id} value={agent.agent_id}>
                                    {agent.hostname || agent.agent_id.substring(0, 12)}
                                </option>
                            ))}
                        </select>
                        <Monitor className="w-3.5 h-3.5 text-ct-ink3 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    <select
                        className={selectBase + ' w-36'}
                        value={filters.timeRange}
                        onChange={(e) => setFilters({ ...filters, timeRange: e.target.value })}
                    >
                        <option value="1h">Last Hour</option>
                        <option value="24h">Last 24 Hours</option>
                        <option value="7d">Last 7 Days</option>
                        <option value="30d">Last 30 Days</option>
                    </select>

                    <select
                        className={selectBase + ' w-44'}
                        value={filters.category}
                        onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                    >
                        <option value="">Category: All</option>
                        <option value="system">System</option>
                        <option value="process">Process</option>
                        <option value="network">Network</option>
                        <option value="file">File</option>
                        <option value="security">Security</option>
                    </select>

                    <select
                        className={selectBase + ' w-36'}
                        value={filters.severity}
                        onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
                    >
                        <option value="">Any Severity</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                    </select>

                    <ActionButton onClick={exportToCSV} disabled={events.length === 0} variant="ghost">
                        <span className="inline-flex items-center gap-2">
                            <Download className="w-3 h-3" />
                            Export
                        </span>
                    </ActionButton>

                    <div className="ml-auto">
                        <ActionButton onClick={fetchEvents} variant="primary">
                            <span className="inline-flex items-center gap-2">
                                <Activity className="w-3 h-3" />
                                Run Explorer
                            </span>
                        </ActionButton>
                    </div>
                </div>
            </Panel>

            {/* Summary */}
            <div className="flex items-center gap-3 text-[12px] p-3 rounded-sm bg-ct-panel border border-ct-line">
                <Eyebrow>Telemetry Results</Eyebrow>
                <span className="text-ct-ink3">Showing:</span>
                <span className="text-ct-ink font-mono">{agentDisplayName}</span>
                <span className="text-ct-line2">|</span>
                <span className="text-ct-ink font-mono">
                    {filters.timeRange === '1h' ? 'Last Hour' :
                        filters.timeRange === '24h' ? 'Last 24 Hours' :
                            filters.timeRange === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
                </span>
                <span className="text-ct-line2">|</span>
                <span className="text-ct-ink font-mono">Category: {filters.category || 'All'}</span>
            </div>

            {/* Network Insights Summary */}
            {filters.category === 'network' && !loading && events.length > 0 && (
                <Panel>
                    <PanelHead
                        title={
                            <span className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-ct-accent" />
                                Connection Insights &mdash; Top Destinations
                            </span>
                        }
                    />
                    <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {Object.entries(
                            events.reduce((acc: any, ev) => {
                                const ip = ev.metadata?.remote_ip;
                                if (!ip) return acc;
                                if (!acc[ip]) acc[ip] = { count: 0, agents: new Set() };
                                acc[ip].count++;
                                acc[ip].agents.add(ev.agent_id);
                                return acc;
                            }, {})
                        )
                            .sort((a: any, b: any) => b[1].count - a[1].count)
                            .slice(0, 8)
                            .map(([ip, data]: [string, any]) => (
                                <div key={ip} className="rounded-sm border border-ct-line bg-ct-bg2 p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-mono text-[13px] text-ct-accent">{ip}</span>
                                        <StatusPill tone="accent" dot={false}>{data.count} hits</StatusPill>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Monitor className="w-3 h-3 text-ct-ink3" />
                                        <span className="text-[11px] text-ct-ink3 font-mono truncate">
                                            {Array.from(data.agents).map((id: any) =>
                                                agents.find(a => a.agent_id === id)?.hostname || id.substring(0, 8)
                                            ).join(', ')}
                                        </span>
                                    </div>
                                </div>
                            ))}
                    </div>
                </Panel>
            )}

            {/* Events Table */}
            <Panel>
                <div className="overflow-x-auto">
                    <table className="w-full text-[13px] text-left">
                        <thead className="bg-ct-bg2 border-b border-ct-line">
                            <tr>
                                <th className="px-4 py-3 w-10"></th>
                                <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium w-28" style={{ letterSpacing: '0.18em' }}>Time</th>
                                <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium w-40" style={{ letterSpacing: '0.18em' }}>Endpoint</th>
                                <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium w-40" style={{ letterSpacing: '0.18em' }}>Event Type</th>
                                <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Description</th>
                                <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium w-28" style={{ letterSpacing: '0.18em' }}>Category</th>
                                <th className="px-4 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium w-24 text-center" style={{ letterSpacing: '0.18em' }}>Severity</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-16">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-6 h-6 rounded-full animate-spin" style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }} />
                                            <span className="text-[11px] text-ct-ink3 font-mono uppercase" style={{ letterSpacing: '0.18em' }}>Loading telemetry</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : events.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-16 text-ct-ink3 text-[13px]">
                                        No telemetry data matching current filters.
                                    </td>
                                </tr>
                            ) : (
                                Object.entries(groupedEvents).map(([dateGroup, groupEvents]) => (
                                    <>
                                        <tr
                                            key={`header-${dateGroup}`}
                                            className="bg-ct-bg2 cursor-pointer hover:bg-ct-panel-hi transition-colors border-y border-ct-line"
                                            onClick={() => toggleGroup(dateGroup)}
                                        >
                                            <td colSpan={7} className="px-4 py-2.5">
                                                <div className="flex items-center gap-2">
                                                    {collapsedGroups.has(dateGroup) ? (
                                                        <ChevronRight className="w-3.5 h-3.5 text-ct-ink3" />
                                                    ) : (
                                                        <ChevronDown className="w-3.5 h-3.5 text-ct-ink3" />
                                                    )}
                                                    <span className="text-[11px] font-mono uppercase text-ct-ink2 font-medium" style={{ letterSpacing: '0.18em' }}>{dateGroup}</span>
                                                    <span className="text-[11px] font-mono text-ct-ink3 tabular-nums">({groupEvents.length} events)</span>
                                                </div>
                                            </td>
                                        </tr>

                                        {!collapsedGroups.has(dateGroup) && groupEvents.map((event) => (
                                            <>
                                                <tr
                                                    key={event.id}
                                                    className={`hover:bg-ct-bg2 cursor-pointer transition-colors border-b border-ct-line ${expandedRow === event.id ? 'bg-ct-bg2' : ''}`}
                                                    onClick={() => setExpandedRow(expandedRow === event.id ? null : event.id)}
                                                >
                                                    <td className="px-4 py-3 text-ct-ink3">
                                                        {expandedRow === event.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                                    </td>
                                                    <td className="px-4 py-3 font-mono text-[11px] text-ct-ink2 tabular-nums">
                                                        {formatWATPattern(eventServerTime(event), 'hh:mm:ss a')}
                                                        {formatSkew(event) && (
                                                            <span title="The endpoint's own clock disagreed with the server by this much when the event arrived. Time shown is server-received (authoritative)." className="ml-1.5 text-[9px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-1 py-0.5 whitespace-nowrap">⚠ {formatSkew(event)}</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <Monitor className="w-3 h-3 text-ct-accent" />
                                                            <span className="text-ct-ink font-mono text-[12px]">
                                                                {agents.find(a => a.agent_id === event.agent_id)?.hostname || event.agent_id.substring(0, 12)}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="text-ct-ink2 font-mono text-[11px] uppercase" style={{ letterSpacing: '0.10em' }}>{event.event_type?.replace(/_/g, ' ')}</span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {getEventDescription(event)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-1.5 text-ct-ink2 text-[12px]">
                                                            {getCategoryIcon(event.category)}
                                                            <span className="capitalize font-mono">{event.category}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <StatusPill tone={getSeverityTone(event.severity)} dot={false}>{event.severity}</StatusPill>
                                                    </td>
                                                </tr>

                                                {expandedRow === event.id && (
                                                    <tr className="bg-ct-bg">
                                                        <td colSpan={7} className="px-6 py-4 border-t border-ct-line">
                                                            <div className="flex items-center justify-between mb-2">
                                                                <Eyebrow>Metadata Payload</Eyebrow>
                                                                <span className="text-[10px] text-ct-ink3 font-mono">ID: {event.id}</span>
                                                            </div>
                                                            <pre className="bg-ct-bg2 p-3 rounded-sm border border-ct-line text-[11px] font-mono text-ct-accent overflow-auto max-h-48">
                                                                {JSON.stringify(event.metadata, null, 2)}
                                                            </pre>
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        ))}
                                    </>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Panel>

            {/* Footer / Pagination */}
            <div className="flex items-center justify-between text-[12px]">
                <span className="text-ct-ink3 font-mono tabular-nums">{events.length} Events</span>

                {totalPages > 1 && (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                            disabled={currentPage === 1}
                            className="p-2 rounded-sm hover:bg-ct-panel-hi text-ct-ink3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" />
                        </button>

                        {getPageNumbers().map((page, idx) => (
                            typeof page === 'number' ? (
                                <button
                                    key={idx}
                                    onClick={() => setCurrentPage(page)}
                                    className="w-8 h-8 rounded-sm text-[11px] font-mono font-medium transition-colors border"
                                    style={{
                                        color: currentPage === page ? 'var(--ct-accent)' : 'var(--ct-ink3)',
                                        borderColor: currentPage === page ? 'var(--ct-accent-border)' : 'transparent',
                                        background: currentPage === page ? 'var(--ct-accent-soft)' : 'transparent',
                                    }}
                                >
                                    {page}
                                </button>
                            ) : (
                                <span key={idx} className="text-ct-ink4 px-1">…</span>
                            )
                        ))}

                        <button
                            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                            disabled={currentPage === totalPages}
                            className="p-2 rounded-sm hover:bg-ct-panel-hi text-ct-ink3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                        >
                            <span className="text-[11px] font-mono uppercase" style={{ letterSpacing: '0.14em' }}>Next</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
