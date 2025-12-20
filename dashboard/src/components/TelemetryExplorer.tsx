import { useState, useEffect } from 'react'
import { getEvents, getAgents, Event, Agent } from '@/lib/api'
import { format } from 'date-fns'
import {
    Activity,
    Filter,
    Search,
    Monitor,
    Clock,
    AlertCircle,
    Box,
    Globe,
    FileCode,
    ShieldAlert,
    ChevronDown,
    ChevronRight
} from 'lucide-react'

export function TelemetryExplorer() {
    const [events, setEvents] = useState<Event[]>([])
    const [agents, setAgents] = useState<Agent[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedRow, setExpandedRow] = useState<string | null>(null)

    // Filters
    const [filters, setFilters] = useState({
        agent_id: '',
        category: '',
        severity: '',
        event_type: '',
        start_time: '',
        end_time: ''
    })

    useEffect(() => {
        // Fetch Agents for filter
        getAgents().then(setAgents).catch(console.error)
        fetchEvents()
    }, [])

    const fetchEvents = async () => {
        setLoading(true)
        try {
            const cleanFilters: any = {}
            if (filters.agent_id) cleanFilters.agent_id = filters.agent_id
            if (filters.category) cleanFilters.category = filters.category
            if (filters.severity) cleanFilters.severity = filters.severity
            if (filters.event_type) cleanFilters.event_type = filters.event_type

            const data = await getEvents({
                ...cleanFilters,
                limit: 200 // Higher limit for explorer
            })
            setEvents(data)
        } catch (error) {
            console.error('Failed to fetch telemetry', error)
        } finally {
            setLoading(false)
        }
    }

    const getSeverityColor = (sev: string) => {
        switch (sev) {
            case 'critical': return 'text-red-500 border-red-900/50 bg-red-900/20'
            case 'high': return 'text-orange-500 border-orange-900/50 bg-orange-900/20'
            case 'medium': return 'text-yellow-500 border-yellow-900/50 bg-yellow-900/20'
            default: return 'text-blue-400 border-blue-900/50 bg-blue-900/20'
        }
    }

    const getCategoryIcon = (cat: string) => {
        switch (cat) {
            case 'process': return <Box className="w-4 h-4" />
            case 'network': return <Globe className="w-4 h-4" />
            case 'file': return <FileCode className="w-4 h-4" />
            case 'security': return <ShieldAlert className="w-4 h-4" />
            default: return <Activity className="w-4 h-4" />
        }
    }

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap gap-3 items-end bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-md">
                <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Agent</label>
                    <div className="relative">
                        <select
                            className="bg-slate-950 border border-white/5 rounded-lg px-3 py-2 pl-9 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all w-56 appearance-none shadow-inner"
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
                    </div>
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Category</label>
                    <select
                        className="bg-slate-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-cyan-500/50 w-36 shadow-inner"
                        value={filters.category}
                        onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                    >
                        <option value="">All Activity</option>
                        <option value="system">System</option>
                        <option value="user">User</option>
                        <option value="process">Process</option>
                        <option value="network">Network</option>
                        <option value="file">File</option>
                        <option value="security">Security</option>
                    </select>
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 ml-1">Severity</label>
                    <select
                        className="bg-slate-950 border border-white/5 rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:ring-1 focus:ring-cyan-500/50 w-32 shadow-inner"
                        value={filters.severity}
                        onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
                    >
                        <option value="">Any Severity</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                    </select>
                </div>

                <button
                    onClick={() => fetchEvents()}
                    className="bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded-lg text-sm flex items-center gap-2 h-[38px] transition-all font-medium active:scale-95 shadow-lg shadow-cyan-950/20"
                >
                    <Search className="w-4 h-4" /> Run Explorer
                </button>
            </div>

            {/* Observation Table */}
            <div className="bg-slate-900/30 border border-white/5 rounded-xl overflow-hidden backdrop-blur-sm">
                <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-white/5 text-slate-500 font-bold uppercase tracking-wider">
                        <tr>
                            <th className="px-4 py-3 w-10"></th>
                            <th className="px-4 py-3 w-40">Time (UTC)</th>
                            <th className="px-4 py-3 w-40">Endpoint</th>
                            <th className="px-4 py-3">Event Type</th>
                            <th className="px-4 py-3 w-28">Category</th>
                            <th className="px-4 py-3 w-24 text-center">Severity</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {loading ? (
                            <tr><td colSpan={6} className="text-center py-20 text-slate-500 animate-pulse">Polling high-volume observation stream...</td></tr>
                        ) : events.length === 0 ? (
                            <tr><td colSpan={6} className="text-center py-20 text-slate-500 italic">No telemetry data matching current filters.</td></tr>
                        ) : (
                            events.map((event) => (
                                <>
                                    <tr
                                        key={event.id}
                                        className={`hover:bg-white/5 cursor-pointer transition-colors group ${expandedRow === event.id ? 'bg-white/5' : ''}`}
                                        onClick={() => setExpandedRow(expandedRow === event.id ? null : event.id)}
                                    >
                                        <td className="px-4 py-3 text-slate-600 group-hover:text-slate-400">
                                            {expandedRow === event.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-slate-400">
                                            {format(new Date(event.timestamp), 'HH:mm:ss.SSS')}
                                            <span className="block text-[9px] text-slate-600 mt-0.5">{format(new Date(event.timestamp), 'yyyy-MM-dd')}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <Monitor className="w-3 h-3 text-cyan-500/50" />
                                                <span className="text-slate-300 font-medium">{event.agent_id.substring(0, 8)}...</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="text-slate-100 font-mono tracking-tighter">{event.event_type}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1.5 text-slate-400">
                                                {getCategoryIcon(event.category)}
                                                <span className="capitalize">{event.category}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase text-center w-full ${getSeverityColor(event.severity)}`}>
                                                {event.severity}
                                            </div>
                                        </td>
                                    </tr>

                                    {expandedRow === event.id && (
                                        <tr className="bg-black/20">
                                            <td colSpan={6} className="px-4 py-4 border-t border-white/5">
                                                <div className="grid grid-cols-1 gap-3">
                                                    <div className="flex items-center justify-between">
                                                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Metadata Payload</h4>
                                                        <span className="text-[10px] text-slate-600 font-mono">ID: {event.id}</span>
                                                    </div>
                                                    <pre className="bg-slate-950/80 p-4 rounded-lg border border-white/5 text-[11px] font-mono text-cyan-400/80 overflow-auto max-h-64 shadow-inner custom-scrollbar">
                                                        {JSON.stringify(event.metadata, null, 2)}
                                                    </pre>
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

            {/* Legend / Info */}
            <div className="flex items-center justify-between text-[10px] text-slate-600 uppercase tracking-tighter pt-2">
                <div className="flex gap-4">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> High Precision Timestamps</span>
                    <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Observation ONLY - No Destructive Actions</span>
                </div>
                <span>{events.length} observable records captured</span>
            </div>
        </div>
    )
}
