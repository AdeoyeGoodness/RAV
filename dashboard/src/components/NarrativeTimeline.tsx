import { useState, useEffect, useMemo } from 'react'
import { getAuditLogs, getOrgAuditLogs, getEvents, AuditLog, Event, getAgents, Agent } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { format, differenceInMinutes, isSameDay } from 'date-fns'
import {
    Shield,
    Activity,
    ChevronDown,
    ChevronRight,
    Clock,
    Box,
    Globe,
    FileCode,
    Camera,
    Usb,
    Search,
    Crosshair
} from 'lucide-react'

// Unified Type for the UI
type TimelineItem = {
    id: string
    timestamp: Date
    type: 'audit' | 'telemetry'
    actor?: string
    action: string
    category?: string
    severity?: string
    metadata: any
    raw: AuditLog | Event
}

type TimelineGroup = {
    id: string
    items: TimelineItem[]
    isCollapsed: boolean
    groupType: 'audit' | 'telemetry_context'
    startTime: Date
    endTime: Date
    summary: string
}

export function NarrativeTimeline() {
    const { user } = useAuth()
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
    const [telemetry, setTelemetry] = useState<Event[]>([])
    const [agents, setAgents] = useState<Agent[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
    const [filterAgent, setFilterAgent] = useState<string>('')

    useEffect(() => {
        fetchData()
        getAgents().then(setAgents).catch(console.error)
    }, [filterAgent, user]) // Added user to dependency array

    const fetchData = async () => {
        if (!user) return;
        setLoading(true)
        try {
            const tData = await getEvents({ limit: 300, agent_id: filterAgent || undefined })
            setTelemetry(tData)

            try {
                let aData: AuditLog[] = []
                if (user.role === 'super_admin') {
                    aData = await getAuditLogs({ limit: 100 })
                } else {
                    aData = await getOrgAuditLogs({ limit: 100 })
                }
                setAuditLogs(aData)
            } catch (e) {
                console.error('Audit Log Sync Error:', e)
                setAuditLogs([])
            }
        } catch (error) {
            console.error('Narrative Sync Error:', error)
        } finally {
            setLoading(false)
        }
    }

    // Normalization and Grouping Logic
    const timelineGroups = useMemo(() => {
        // 1. Normalize all items
        const allItems: TimelineItem[] = [
            ...auditLogs.map(a => ({
                id: a.id,
                timestamp: new Date(a.timestamp),
                type: 'audit' as const,
                actor: a.actor_type,
                action: a.action_type,
                metadata: a.metadata,
                raw: a
            })),
            ...telemetry.map(t => ({
                id: t.id,
                timestamp: new Date(t.timestamp),
                type: 'telemetry' as const,
                category: t.category,
                severity: t.severity,
                action: t.event_type,
                metadata: t.metadata,
                raw: t
            }))
        ]

        // 2. Sort by time DESC
        allItems.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

        // 3. Grouping Logic (Noise Reduction)
        const groups: TimelineGroup[] = []
        let currentGroup: TimelineGroup | null = null

        allItems.forEach((item, idx) => {
            // Audit logs ALWAYS start a new group and are isolated (no collapsing for authority)
            if (item.type === 'audit') {
                groups.push({
                    id: `audit-${item.id}`,
                    items: [item],
                    isCollapsed: false,
                    groupType: 'audit',
                    startTime: item.timestamp,
                    endTime: item.timestamp,
                    summary: item.action
                })
                currentGroup = null
                return
            }

            // Telemetry grouping
            if (currentGroup && currentGroup.groupType === 'telemetry_context') {
                const lastItem = currentGroup.items[0]
                const timeDiff = differenceInMinutes(lastItem.timestamp, item.timestamp)

                // Group if: within 10 mins AND same category
                if (timeDiff < 10 && (item.category === lastItem.category || item.action === lastItem.action)) {
                    currentGroup.items.push(item)
                    currentGroup.endTime = item.timestamp
                    currentGroup.summary = `${currentGroup.items.length} ${item.category || 'System'} events`
                    return
                }
            }

            // Start a new telemetry group
            currentGroup = {
                id: `group-${item.id}`,
                items: [item],
                isCollapsed: true,
                groupType: 'telemetry_context',
                startTime: item.timestamp,
                endTime: item.timestamp,
                summary: item.action
            }
            groups.push(currentGroup)
        })

        return groups
    }, [auditLogs, telemetry])

    const toggleGroup = (groupId: string) => {
        const newSet = new Set(expandedGroups)
        if (newSet.has(groupId)) newSet.delete(groupId)
        else newSet.add(groupId)
        setExpandedGroups(newSet)
    }

    const getEventIcon = (item: TimelineItem) => {
        if (item.type === 'audit') return <Shield className="w-4 h-4 text-purple-400" />
        if (item.action.includes('SCREENSHOT')) return <Camera className="w-4 h-4 text-pink-400" />
        if (item.action.includes('USB')) return <Usb className="w-4 h-4 text-orange-400" />

        switch (item.category) {
            case 'process': return <Box className="w-4 h-4 text-cyan-400" />
            case 'network': return <Globe className="w-4 h-4 text-blue-400" />
            case 'file': return <FileCode className="w-4 h-4 text-green-400" />
            default: return <Activity className="w-4 h-4 text-slate-400" />
        }
    }

    return (
        <div className="space-y-6">
            {/* Narrative Header */}
            <div className="flex items-center justify-between p-5 rounded-2xl border border-white/10 backdrop-blur-xl bg-slate-900/40 shadow-2xl overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="flex items-center gap-4 relative z-10">
                    <div className="p-2.5 bg-gradient-to-br from-purple-500/20 to-indigo-600/20 rounded-xl border border-purple-500/20 shadow-inner">
                        <Crosshair className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-white tracking-tight">Forensic Session Narrative</h2>
                        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                            Live Audit & Telemetry Convergence
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 relative z-10">
                    <div className="relative group">
                        <select
                            className="appearance-none bg-slate-950/50 border border-white/10 rounded-lg pl-3 pr-8 py-2 text-xs text-slate-300 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-all cursor-pointer backdrop-blur-md"
                            value={filterAgent}
                            onChange={(e) => setFilterAgent(e.target.value)}
                        >
                            <option value="">Global Narrative</option>
                            {agents.map(a => (
                                <option key={a.agent_id} value={a.agent_id}>{a.hostname || a.agent_id.substring(0, 8)}</option>
                            ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none group-focus-within:rotate-180 transition-transform" />
                    </div>
                    <button
                        onClick={fetchData}
                        className="p-2 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-lg transition-all active:scale-95 group"
                        title="Refresh Narrative"
                    >
                        <Search className={`w-4 h-4 text-slate-400 group-hover:text-white ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* The Thread */}
            <div className="relative pl-10 space-y-6">
                {/* The Vertical Line - Enterprise Styled */}
                <div className="absolute left-[47px] top-6 bottom-6 w-[2px] bg-gradient-to-b from-purple-500/40 via-cyan-400/20 to-transparent" />

                {loading && auditLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-32 space-y-4">
                        <div className="w-12 h-12 border-2 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
                        <div className="text-sm font-medium text-slate-500 animate-pulse tracking-wide">Syncing Multi-Stream Data...</div>
                    </div>
                ) : timelineGroups.map((group, gIdx) => (
                    <div key={group.id} className="relative group/line animate-in fade-in slide-in-from-left-4 duration-500" style={{ animationDelay: `${gIdx * 50}ms` }}>
                        {/* Timeline Dot with Aura */}
                        <div className="absolute -left-[5px] top-4 z-20">
                            <div className={`
                                w-3 h-3 rounded-full border-2 border-slate-950 shadow-xl transition-all duration-300
                                ${group.groupType === 'audit'
                                    ? 'bg-purple-500 shadow-purple-500/40'
                                    : 'bg-slate-700 border-slate-600 group-hover/line:bg-cyan-500 group-hover/line:shadow-cyan-500/40'}
                            `} />
                            {group.groupType === 'audit' && (
                                <div className="absolute -inset-1.5 bg-purple-500/20 rounded-full blur-sm -z-10 animate-pulse" />
                            )}
                        </div>

                        {/* Date Separator (Sleek Sidebar Style) */}
                        {(gIdx === 0 || !isSameDay(group.startTime, timelineGroups[gIdx - 1].startTime)) && (
                            <div className="absolute -left-[90px] top-3 text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] transform -rotate-90 origin-right transition-colors group-hover/line:text-slate-400">
                                {format(group.startTime, 'MMM dd')}
                            </div>
                        )}

                        {/* Block Card - Modern Card Design */}
                        <div className={`
                            rounded-2xl p-5 border backdrop-blur-sm transition-all duration-300
                            ${group.groupType === 'audit'
                                ? 'bg-purple-600/[0.03] border-purple-500/20 hover:border-purple-500/40 shadow-xl shadow-purple-950/20'
                                : 'bg-slate-900/40 border-white/5 hover:border-white/10 hover:bg-slate-900/60 shadow-lg hover:shadow-cyan-950/10'}
                            ${expandedGroups.has(group.id) ? 'active-border-glow' : ''}
                        `}>
                            {/* Summary Header */}
                            <div
                                className={`flex items-center justify-between cursor-pointer group/header`}
                                onClick={() => group.items.length > 1 && toggleGroup(group.id)}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`
                                        p-2.5 rounded-xl transition-all duration-300 border
                                        ${group.groupType === 'audit'
                                            ? 'bg-purple-500/10 border-purple-500/20 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.1)]'
                                            : 'bg-slate-800/40 border-white/5 text-slate-400 group-hover/header:bg-slate-800/80 group-hover/header:text-cyan-400'}
                                    `}>
                                        {getEventIcon(group.items[0])}
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-3">
                                            <span className="text-[11px] font-bold font-mono text-slate-500 bg-slate-900/80 px-2 py-0.5 rounded-md border border-white/5">
                                                {format(group.startTime, 'HH:mm')}
                                            </span>
                                            <span className={`text-[9px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded
                                                ${group.groupType === 'audit'
                                                    ? 'text-purple-400 bg-purple-500/10 border border-purple-500/10'
                                                    : 'text-slate-600 bg-slate-950 border border-transparent'}
                                            `}>
                                                {group.groupType === 'audit' ? 'Authority Action' : 'Observation Context'}
                                            </span>
                                        </div>
                                        <h3 className={`text-sm font-semibold tracking-tight transition-colors
                                            ${group.groupType === 'audit' ? 'text-purple-100' : 'text-slate-300 group-hover/header:text-white'}
                                        `}>
                                            {group.summary}
                                        </h3>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    {group.items.length > 1 && (
                                        <div className="px-3 py-1.5 rounded-lg bg-slate-950/50 border border-white/5 flex items-center gap-3">
                                            <div className="flex -space-x-1.5 overflow-hidden">
                                                {group.items.slice(0, 3).map((item, i) => (
                                                    <div key={item.id} className="w-5 h-5 rounded-full bg-slate-800 border-2 border-slate-900 flex items-center justify-center scale-90">
                                                        {getEventIcon(item)}
                                                    </div>
                                                ))}
                                                {group.items.length > 3 && (
                                                    <div className="w-5 h-5 rounded-full bg-indigo-500/20 border-2 border-slate-900 text-[8px] font-bold text-indigo-400 flex items-center justify-center scale-90">
                                                        +{group.items.length - 3}
                                                    </div>
                                                )}
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-500 font-mono">{format(group.endTime, 'HH:mm')}</span>
                                            <div className={`p-1 rounded-md transition-all ${expandedGroups.has(group.id) ? 'bg-purple-500/10 text-purple-400' : 'text-slate-600'}`}>
                                                {expandedGroups.has(group.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Expansion Details */}
                            {(expandedGroups.has(group.id) || group.items.length === 1) && (
                                <div className="mt-5 pt-5 border-t border-white/10 space-y-4">
                                    {group.items.map((item, iIdx) => (
                                        <div key={item.id} className="group/item relative">
                                            <div className="flex gap-4 p-3 rounded-xl hover:bg-white/[0.02] transition-all border border-transparent hover:border-white/5">
                                                <div className="flex flex-col items-center gap-1 w-12 shrink-0">
                                                    <span className="text-[10px] text-slate-500 font-bold font-mono">{format(item.timestamp, 'HH:mm:ss')}</span>
                                                    <div className="w-1 h-1 rounded-full bg-slate-800 group-hover/item:bg-cyan-500 transition-colors" />
                                                </div>

                                                <div className="flex-1 space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`text-[11px] font-bold tracking-tight ${group.groupType === 'audit' ? 'text-purple-300' : 'text-slate-200'}`}>
                                                                {item.action}
                                                            </span>
                                                            {item.severity === 'critical' && (
                                                                <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse" />
                                                            )}
                                                        </div>
                                                        {item.type === 'telemetry' && (
                                                            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-600 bg-slate-950 px-2 py-1 rounded shadow-inner border border-white/5">
                                                                {item.category || 'System'}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {item.type === 'audit' && (
                                                        <div className="flex items-center gap-2">
                                                            <div className="px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-md text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                                                                <Shield className="w-3 h-3" />
                                                                Actor: {item.actor}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Enterprise Metadata Grid */}
                                                    {(item.action.includes('LOGIN') || item.action.includes('ERROR') || item.severity === 'critical' || expandedGroups.has(group.id)) && (
                                                        <div className="mt-3 overflow-hidden rounded-xl border border-white/5 bg-black/40 shadow-inner group-hover/item:border-white/10 transition-colors">
                                                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.03] border-b border-white/5">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                                                                <span className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-500">Payload Integrity Proof</span>
                                                            </div>
                                                            <div className="p-3">
                                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                                                                    {Object.entries(item.metadata).map(([key, value]) => (
                                                                        value !== null && typeof value !== 'object' && (
                                                                            <div key={key} className="flex items-baseline justify-between gap-4 border-b border-white/[0.02] last:border-0 pb-1">
                                                                                <span className="text-[9px] font-bold uppercase text-slate-600 tracking-wider shrink-0">{key.replace(/_/g, ' ')}</span>
                                                                                <span className="text-[10px] font-mono text-cyan-400/90 truncate max-w-[200px]" title={String(value)}>{String(value)}</span>
                                                                            </div>
                                                                        )
                                                                    ))}
                                                                </div>
                                                                {/* Catch-all for objects if needed */}
                                                                {Object.values(item.metadata).some(v => typeof v === 'object' && v !== null) && (
                                                                    <pre className="mt-2 text-[10px] p-2 bg-slate-950/80 rounded border border-white/5 text-purple-300/80 overflow-auto max-h-32 scrollbar-thin">
                                                                        {JSON.stringify(item.metadata, null, 2)}
                                                                    </pre>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <style jsx>{`
                .active-border-glow {
                    position: relative;
                }
                .active-border-glow::before {
                    content: '';
                    position: absolute;
                    inset: -1px;
                    border-radius: inherit;
                    padding: 1px;
                    background: linear-gradient(to bottom, rgba(168, 85, 247, 0.5), transparent);
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor;
                    mask-composite: exclude;
                    pointer-events: none;
                }
            `}</style>
        </div>
    )
}
