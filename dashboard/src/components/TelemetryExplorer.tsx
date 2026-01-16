import { useState, useEffect, useMemo } from 'react'
import { getEvents, getAgents, Event, Agent } from '@/lib/api'
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import {
    Monitor,
    ChevronDown,
    ChevronRight,
    ChevronLeft,
    Download,
    Search,
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
    const [currentPage, setCurrentPage] = useState(1)
    const eventsPerPage = 50

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

            const data = await getEvents(cleanFilters)
            setEvents(data)
            setCurrentPage(1)
        } catch (error) {
            console.error('Failed to fetch telemetry', error)
        } finally {
            setLoading(false)
        }
    }

    // Group events by date
    const groupedEvents = useMemo(() => {
        const groups: { [key: string]: Event[] } = {}

        events.forEach(event => {
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
    }, [events])

    // Pagination
    const totalPages = Math.ceil(events.length / eventsPerPage)
    const paginatedEvents = events.slice((currentPage - 1) * eventsPerPage, currentPage * eventsPerPage)

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

        // Build description based on event type
        if (event.event_type === 'NETWORK_CONNECTION') {
            return (
                <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-400">Network connection</span>
                    {meta.remote_ip && <span className="text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded text-[10px]">{meta.remote_ip}</span>}
                    {meta.process_name && (
                        <>
                            <span className="text-slate-600">⎯</span>
                            <span className="text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                                <span>📦</span> {meta.process_name}
                            </span>
                        </>
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

        if (event.event_type === 'BROWSER_HISTORY') {
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
                    <span className="text-slate-300">Sensitive File Transfer</span>
                    {meta.file_path && (
                        <span className="bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded text-[9px] font-bold">DETECTED</span>
                    )}
                </span>
            )
        }

        if (event.event_type?.includes('PROCESS')) {
            return (
                <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-emerald-400">◇</span>
                    <span className="text-slate-300">{meta.process_name || 'Process activity'}</span>
                    {meta.command_line && (
                        <span className="text-slate-500 text-[10px] truncate max-w-[200px]">{meta.command_line}</span>
                    )}
                </span>
            )
        }

        // Default
        return (
            <span className="text-slate-400">{event.event_type?.replace(/_/g, ' ').toLowerCase()}</span>
        )
    }

    return (
        <div className="space-y-4">
            {/* Filter Bar */}
            <div className="flex items-center gap-3 flex-wrap">
                {/* Agent Select */}
                <div className="relative">
                    <select
                        className="bg-[#131524]/80 border border-white/10 rounded-lg px-3 py-2 pl-9 pr-8 text-sm text-slate-300 outline-none focus:border-cyan-500/50 transition-all w-52 appearance-none"
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
                    <Monitor className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Time Range */}
                <div className="relative">
                    <select
                        className="bg-[#131524]/80 border border-white/10 rounded-lg px-3 py-2 pr-8 text-sm text-slate-300 outline-none focus:border-cyan-500/50 transition-all w-36 appearance-none"
                        value={filters.timeRange}
                        onChange={(e) => setFilters({ ...filters, timeRange: e.target.value })}
                    >
                        <option value="1h">Last Hour</option>
                        <option value="24h">Last 24 Hours</option>
                        <option value="7d">Last 7 Days</option>
                        <option value="30d">Last 30 Days</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Category */}
                <div className="relative">
                    <select
                        className="bg-[#131524]/80 border border-white/10 rounded-lg px-3 py-2 pr-8 text-sm text-slate-300 outline-none focus:border-cyan-500/50 transition-all w-40 appearance-none"
                        value={filters.category}
                        onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                    >
                        <option value="">Category: All Activity</option>
                        <option value="system">System</option>
                        <option value="process">Process</option>
                        <option value="network">Network</option>
                        <option value="file">File</option>
                        <option value="security">Security</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Severity */}
                <div className="relative">
                    <select
                        className="bg-[#131524]/80 border border-white/10 rounded-lg px-3 py-2 pr-8 text-sm text-slate-300 outline-none focus:border-cyan-500/50 transition-all w-36 appearance-none"
                        value={filters.severity}
                        onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
                    >
                        <option value="">Any Severity</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Export */}
                <button className="px-4 py-2 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-colors text-sm flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    Export
                </button>

                {/* Run Explorer */}
                <button
                    onClick={fetchEvents}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center gap-2 transition-colors ml-auto"
                >
                    Run Explorer
                </button>
            </div>

            {/* Results Summary */}
            <div className="flex items-center gap-2 text-sm">
                <span className="text-white font-bold">Telemetry Results</span>
                <span className="text-slate-500">Showing:</span>
                <span className="text-slate-300">{agentDisplayName}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-300">{filters.timeRange === '24h' ? 'Last 24 Hours' : filters.timeRange}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-300">Categories: {filters.category || 'All Activity'}</span>
                <ChevronDown className="w-4 h-4 text-slate-500" />
            </div>

            {/* Events Table */}
            <div className="bg-[#131524]/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-white/5 border-b border-white/5">
                        <tr>
                            <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-10"></th>
                            <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-28">Time (UTC)</th>
                            <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-40">Endpoint</th>
                            <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-36">Event Type</th>
                            <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Description</th>
                            <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-24">Category</th>
                            <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-24 text-center">Severity</th>
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
                                    {/* Date Group Header */}
                                    <tr key={`header-${dateGroup}`} className="bg-[#0A0B14]/50">
                                        <td colSpan={7} className="px-4 py-2">
                                            <span className="text-xs font-bold text-slate-400">{dateGroup}</span>
                                            {dateGroup !== 'Today' && dateGroup !== 'Yesterday' && (
                                                <span className="text-xs text-slate-600 ml-4">{format(parseISO(groupEvents[0].timestamp), 'yyyy')}</span>
                                            )}
                                        </td>
                                    </tr>

                                    {/* Events in this group */}
                                    {groupEvents.slice(0, 10).map((event) => (
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
                                                <tr className="bg-black/30">
                                                    <td colSpan={7} className="px-6 py-4 border-t border-white/5">
                                                        <div className="flex items-center justify-between mb-3">
                                                            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Metadata Payload</h4>
                                                            <span className="text-[10px] text-slate-600 font-mono">ID: {event.id}</span>
                                                        </div>
                                                        <pre className="bg-[#0A0B14] p-4 rounded-lg border border-white/5 text-[11px] font-mono text-cyan-400/80 overflow-auto max-h-48">
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

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg hover:bg-white/5 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>

                    {[1, 2, 3].slice(0, totalPages).map(page => (
                        <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${currentPage === page
                                    ? 'bg-blue-600 text-white'
                                    : 'hover:bg-white/5 text-slate-400'
                                }`}
                        >
                            {page}
                        </button>
                    ))}

                    {totalPages > 3 && (
                        <>
                            <span className="text-slate-600 px-1">...</span>
                            <button
                                onClick={() => setCurrentPage(totalPages)}
                                className="w-8 h-8 rounded-lg text-xs font-medium hover:bg-white/5 text-slate-400 transition-colors"
                            >
                                {totalPages}
                            </button>
                        </>
                    )}

                    <button
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-lg hover:bg-white/5 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>

                    <span className="text-slate-400 ml-2">Next →</span>
                </div>
            </div>
        </div>
    )
}
