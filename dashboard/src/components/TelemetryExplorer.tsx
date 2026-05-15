import { useState, useEffect, useMemo } from 'react'
import { getEvents, getAgents, Event, Agent } from '@/lib/api'
import { format, isToday, isYesterday, parseISO, subHours, subDays } from 'date-fns'
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

export function TelemetryExplorer({ initialAgentId }: { initialAgentId?: string }) {
    const [events, setEvents] = useState<Event[]>([])
    const [agents, setAgents] = useState<Agent[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedRow, setExpandedRow] = useState<string | null>(null)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
    const [currentPage, setCurrentPage] = useState(1)
    const eventsPerPage = 30

    // Filters
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

            // Time range filtering
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
            setCollapsedGroups(new Set()) // Reset collapsed state on new fetch
        } catch (error) {
            console.error('Failed to fetch telemetry', error)
        } finally {
            setLoading(false)
        }
    }

    // Export to CSV
    const exportToCSV = () => {
        if (events.length === 0) return

        // CSV headers
        const headers = ['Timestamp', 'Agent ID', 'Hostname', 'Event Type', 'Category', 'Severity', 'Metadata']

        // Map events to CSV rows
        const rows = events.map(event => {
            const agent = agents.find(a => a.agent_id === event.agent_id)
            return [
                event.timestamp,
                event.agent_id,
                agent?.hostname || 'Unknown',
                event.event_type,
                event.category,
                event.severity,
                JSON.stringify(event.metadata || {})
            ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')
        })

        // Combine headers and rows
        const csv = [headers.join(','), ...rows].join('\n')

        // Create and trigger download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute('download', `telemetry_export_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`)
        link.style.visibility = 'hidden'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    // Pagination
    const totalPages = Math.ceil(events.length / eventsPerPage)
    const paginatedEvents = useMemo(() => {
        const start = (currentPage - 1) * eventsPerPage
        const end = start + eventsPerPage
        return events.slice(start, end)
    }, [events, currentPage])

    // Group paginated events by date
    const groupedEvents = useMemo(() => {
        const groups: { [key: string]: Event[] } = {}

        paginatedEvents.forEach(event => {
            const date = parseISO(event.timestamp)
            let dateKey: string

            if (isToday(date)) {
                dateKey = 'Today'
            } else if (isYesterday(date)) {
                dateKey = 'Yesterday'
            } else {
                dateKey = format(date, 'MMMM d, yyyy')
            }

            if (!groups[dateKey]) groups[dateKey] = []
            groups[dateKey].push(event)
        })

        return groups
    }, [paginatedEvents])

    // Toggle group collapse
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

    // Get selected agent hostname
    const selectedAgent = agents.find(a => a.agent_id === filters.agent_id)
    const agentDisplayName = selectedAgent?.hostname || (filters.agent_id ? filters.agent_id.substring(0, 12) : 'All Endpoints')

    const getSeverityBadge = (sev: string) => {
        const styles: Record<string, string> = {
            'critical': 'bg-red-500 text-white',
            'high': 'bg-orange-500 text-white',
            'medium': 'bg-yellow-500 text-black',
            'low': 'bg-cyan-500/80 text-white'
        }
        return styles[sev] || styles['low']
    }

    const getCategoryIcon = (cat: string) => {
        switch (cat) {
            case 'network': return <Globe className="w-4 h-4" />
            case 'process': return <Cpu className="w-4 h-4" />
            case 'file': return <FileText className="w-4 h-4" />
            case 'security': return <Shield className="w-4 h-4" />
            default: return <Activity className="w-4 h-4" />
        }
    }

    const getEventDescription = (event: Event) => {
        const meta = event.metadata || {}

        if (event.event_type === 'NETWORK_CONNECTION') {
            return (
                <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-400">Network connection</span>
                    {meta.remote_ip && <span className="text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded text-[10px]">{meta.remote_ip}</span>}
                    {meta.process_name && (
                        <span className="text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded text-[10px]">
                            📦 {meta.process_name}
                        </span>
                    )}
                </span>
            )
        }

        if (event.event_type === 'USB_DEVICE_CONNECTED') {
            return (
                <span className="flex items-center gap-2">
                    <span className="text-yellow-400">⬡</span>
                    <span className="text-slate-300">USB device connected</span>
                    {meta.device_name && <span className="text-slate-500">- {meta.device_name}</span>}
                </span>
            )
        }

        if (event.event_type === 'SCREENSHOT_TAKEN') {
            return (
                <span className="flex items-center gap-2">
                    <span className="text-blue-400">📸</span>
                    <span className="text-slate-300">Screenshot captured</span>
                </span>
            )
        }

        if (event.event_type?.includes('BROWSER')) {
            return (
                <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-indigo-400">🌐</span>
                    <span className="text-slate-300">Browser activity</span>
                    {meta.url && <span className="text-slate-500 truncate max-w-[200px]">{meta.url}</span>}
                </span>
            )
        }

        if (event.event_type?.includes('FILE')) {
            return (
                <span className="flex items-center gap-2">
                    <span className="text-purple-400">⬢</span>
                    <span className="text-slate-300">File activity</span>
                    {meta.file_path && <span className="text-slate-500 truncate max-w-[150px]">{meta.file_path}</span>}
                </span>
            )
        }

        if (event.event_type?.includes('PROCESS')) {
            return (
                <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-emerald-400">◇</span>
                    <span className="text-slate-300">{meta.process_name || 'Process activity'}</span>
                </span>
            )
        }

        return <span className="text-slate-400">{event.event_type?.replace(/_/g, ' ').toLowerCase()}</span>
    }

    // Generate page numbers for display
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

    return (
        <div className="space-y-6">
            {/* Filter Bar */}
            <div className="flex items-center gap-3 flex-wrap bg-black/20 p-3 rounded-2xl border border-white/5">
                {/* Agent Select */}
                <div className="relative">
                    <select
                        className="bg-black/40 border border-white/5 rounded-xl px-4 py-2 pl-10 pr-8 text-sm text-slate-300 outline-none focus:border-cyan-500/30 focus:shadow-[0_0_10px_rgba(6,182,212,0.1)] transition-all w-52 appearance-none cursor-pointer"
                        value={filters.agent_id}
                        onChange={(e) => setFilters({ ...filters, agent_id: e.target.value })}
                    >
                        <option value="" className="bg-slate-900">All Endpoints</option>
                        {agents.map(agent => (
                            <option key={agent.agent_id} value={agent.agent_id} className="bg-slate-900">
                                {agent.hostname || agent.agent_id.substring(0, 12)}
                            </option>
                        ))}
                    </select>
                    <Monitor className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Time Range */}
                <div className="relative">
                    <select
                        className="bg-black/40 border border-white/5 rounded-xl px-4 py-2 pr-8 text-sm text-slate-300 outline-none focus:border-cyan-500/30 focus:shadow-[0_0_10px_rgba(6,182,212,0.1)] transition-all w-36 appearance-none cursor-pointer"
                        value={filters.timeRange}
                        onChange={(e) => setFilters({ ...filters, timeRange: e.target.value })}
                    >
                        <option value="1h" className="bg-slate-900">Last Hour</option>
                        <option value="24h" className="bg-slate-900">Last 24 Hours</option>
                        <option value="7d" className="bg-slate-900">Last 7 Days</option>
                        <option value="30d" className="bg-slate-900">Last 30 Days</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Category */}
                <div className="relative">
                    <select
                        className="bg-black/40 border border-white/5 rounded-xl px-4 py-2 pr-8 text-sm text-slate-300 outline-none focus:border-cyan-500/30 focus:shadow-[0_0_10px_rgba(6,182,212,0.1)] transition-all w-44 appearance-none cursor-pointer"
                        value={filters.category}
                        onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                    >
                        <option value="" className="bg-slate-900">Category: All</option>
                        <option value="system" className="bg-slate-900">System</option>
                        <option value="process" className="bg-slate-900">Process</option>
                        <option value="network" className="bg-slate-900">Network</option>
                        <option value="file" className="bg-slate-900">File</option>
                        <option value="security" className="bg-slate-900">Security</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Severity */}
                <div className="relative">
                    <select
                        className="bg-black/40 border border-white/5 rounded-xl px-4 py-2 pr-8 text-sm text-slate-300 outline-none focus:border-cyan-500/30 focus:shadow-[0_0_10px_rgba(6,182,212,0.1)] transition-all w-36 appearance-none cursor-pointer"
                        value={filters.severity}
                        onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
                    >
                        <option value="" className="bg-slate-900">Any Severity</option>
                        <option value="low" className="bg-slate-900">Low</option>
                        <option value="medium" className="bg-slate-900">Medium</option>
                        <option value="high" className="bg-slate-900">High</option>
                        <option value="critical" className="bg-slate-900">Critical</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Export */}
                <button
                    onClick={exportToCSV}
                    disabled={events.length === 0}
                    className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Download className="w-4 h-4" />
                    Export
                </button>

                {/* Run Explorer */}
                <button
                    onClick={fetchEvents}
                    className="px-5 py-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 hover:shadow-[0_0_15px_rgba(6,182,212,0.2)] font-bold uppercase tracking-wider text-xs ml-auto transition-all flex items-center gap-2"
                >
                    <Activity className="w-4 h-4" />
                    Run Explorer
                </button>
            </div>

            {/* Results Summary & Insights */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 text-xs bg-black/20 p-3 rounded-xl border border-white/5 mb-2">
                    <div className="px-2 py-1 bg-cyan-500/10 text-cyan-400 rounded uppercase font-bold tracking-wider">Telemetry Results</div>
                    <span className="text-slate-500 font-medium">Showing:</span>
                    <span className="text-white font-medium">{agentDisplayName}</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-white font-medium">
                        {filters.timeRange === '1h' ? 'Last Hour' :
                            filters.timeRange === '24h' ? 'Last 24 Hours' :
                                filters.timeRange === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
                    </span>
                    <span className="text-slate-600">|</span>
                    <span className="text-white font-medium">Categories: {filters.category || 'All Activity'}</span>
                </div>

                {/* Network Insights Summary — Only shown when category is network */}
                {filters.category === 'network' && !loading && events.length > 0 && (
                    <div className="bg-[#131524]/40 border border-cyan-500/10 rounded-2xl p-5 mb-2 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="flex items-center gap-3 mb-4">
                            <Globe className="w-5 h-5 text-cyan-400" />
                            <h3 className="text-sm font-bold text-white uppercase tracking-widest italic">Connection Insights (Top Destinations)</h3>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                                <div key={ip} className="bg-[#0A0B14]/60 border border-white/5 rounded-xl p-3.5 hover:border-cyan-500/20 transition-all group">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-mono text-sm text-cyan-300 font-bold tracking-tight">{ip}</span>
                                        <span className="text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded uppercase">
                                            {data.count} Hits
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Monitor className="w-3 h-3 text-slate-600" />
                                        <span className="text-[10px] text-slate-500 font-medium truncate">
                                            {Array.from(data.agents).map((id: any) => 
                                                agents.find(a => a.agent_id === id)?.hostname || id.substring(0, 8)
                                            ).join(', ')}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Events Table */}
            <div className="bg-black/20 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
                <table className="w-full text-sm text-left">
                    <thead className="bg-black/40 border-b border-white/5">
                        <tr>
                            <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-10"></th>
                            <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-28">Time (UTC)</th>
                            <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-40">Endpoint</th>
                            <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-36">Event Type</th>
                            <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Description</th>
                            <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-24">Category</th>
                            <th className="px-4 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-24 text-center">Severity</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} className="text-center py-16 text-slate-500">
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
                                        <span>Loading telemetry data...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : events.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="text-center py-16 text-slate-500 italic">
                                    No telemetry data matching current filters.
                                </td>
                            </tr>
                        ) : (
                            Object.entries(groupedEvents).map(([dateGroup, groupEvents]) => (
                                <>
                                    {/* Collapsible Date Group Header */}
                                    <tr
                                        key={`header-${dateGroup}`}
                                        className="bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] transition-colors border-y border-white/5"
                                        onClick={() => toggleGroup(dateGroup)}
                                    >
                                        <td colSpan={7} className="px-4 py-2.5">
                                            <div className="flex items-center gap-2">
                                                {collapsedGroups.has(dateGroup) ? (
                                                    <ChevronRight className="w-4 h-4 text-slate-500" />
                                                ) : (
                                                    <ChevronDown className="w-4 h-4 text-slate-500" />
                                                )}
                                                <span className="text-xs font-bold text-slate-300">{dateGroup}</span>
                                                <span className="text-xs text-slate-600">({groupEvents.length} events)</span>
                                            </div>
                                        </td>
                                    </tr>

                                    {/* Events in this group - only show if not collapsed */}
                                    {!collapsedGroups.has(dateGroup) && groupEvents.map((event) => (
                                        <>
                                            <tr
                                                key={event.id}
                                                className={`hover:bg-white/[0.02] cursor-pointer transition-colors border-b border-white/[0.02] ${expandedRow === event.id ? 'bg-white/[0.02]' : ''}`}
                                                onClick={() => setExpandedRow(expandedRow === event.id ? null : event.id)}
                                            >
                                                <td className="px-4 py-3 text-slate-600">
                                                    {expandedRow === event.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                </td>
                                                <td className="px-4 py-3 font-mono text-xs text-slate-400">
                                                    {format(parseISO(event.timestamp), 'hh:mm:ss a')}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <Monitor className="w-3.5 h-3.5 text-cyan-500" />
                                                        <span className="text-slate-300 font-medium text-xs">
                                                            {agents.find(a => a.agent_id === event.agent_id)?.hostname || event.agent_id.substring(0, 12)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-yellow-400">⬢</span>
                                                        <span className="text-slate-300 text-xs">{event.event_type?.replace(/_/g, ' ')}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-xs">
                                                    {getEventDescription(event)}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                                                        {getCategoryIcon(event.category)}
                                                        <span className="capitalize">{event.category}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${getSeverityBadge(event.severity)}`}>
                                                        {event.severity}
                                                    </span>
                                                </td>
                                            </tr>

                                            {/* Expanded Details */}
                                            {expandedRow === event.id && (
                                                <tr className="bg-black/40">
                                                    <td colSpan={7} className="px-6 py-5 border-t border-white/5">
                                                        <div className="flex items-center justify-between mb-3">
                                                            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2"><Activity className="w-3 h-3" /> Metadata Payload</h4>
                                                            <span className="text-[10px] text-slate-600 font-mono">ID: {event.id}</span>
                                                        </div>
                                                        <pre className="bg-black/60 p-4 rounded-xl border border-white/5 text-[11px] font-mono text-cyan-400/80 overflow-auto max-h-48 custom-scrollbar">
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

            {/* Footer / Pagination */}
            <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{events.length} Events</span>

                {totalPages > 1 && (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                            disabled={currentPage === 1}
                            className="p-2 rounded-lg hover:bg-white/5 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        {getPageNumbers().map((page, idx) => (
                            typeof page === 'number' ? (
                                <button
                                    key={idx}
                                    onClick={() => setCurrentPage(page)}
                                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${currentPage === page
                                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                                        : 'hover:bg-white/5 text-slate-400 border border-transparent'
                                        }`}
                                >
                                    {page}
                                </button>
                            ) : (
                                <span key={idx} className="text-slate-600 px-1">...</span>
                            )
                        ))}

                        <button
                            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                            disabled={currentPage === totalPages}
                            className="p-2 rounded-lg hover:bg-white/5 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                        >
                            <span className="text-xs">Next</span>
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
