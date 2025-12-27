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
        <div className="space-y-8">
            {/* Narrative Header - Ultra Slim & Glassy */}
            <div className="flex items-center justify-between px-6 py-4 rounded-3xl border border-white/5 backdrop-blur-2xl bg-slate-900/30 shadow-2xl overflow-hidden relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 to-transparent pointer-events-none" />
                <div className="flex items-center gap-4 relative z-10">
                    <div className="p-2 bg-gradient-to-br from-purple-500/20 to-indigo-600/20 rounded-2xl border border-purple-500/10 transition-transform group-hover:scale-110 duration-500">
                        <Crosshair className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-sm font-black text-white tracking-widest uppercase">Forensic Stream</h2>
                    </div>
                </div>

                <div className="flex items-center gap-3 relative z-[100]">
                    <div className="relative">
                        <select
                            className="appearance-none bg-slate-950/80 border border-white/10 rounded-2xl pl-4 pr-10 py-1.5 text-[10px] font-bold text-slate-300 uppercase tracking-widest outline-none focus:border-purple-500/60 transition-all cursor-pointer backdrop-blur-xl relative z-[110]"
                            value={filterAgent}
                            onChange={(e) => setFilterAgent(e.target.value)}
                        >
                            <option value="" className="bg-slate-950">Global Narrative</option>
                            {agents.map(a => (
                                <option key={a.agent_id} value={a.agent_id} className="bg-slate-950">{a.hostname || a.agent_id.substring(0, 8)}</option>
                            ))}
                        </select>
                        <ChevronDown className="w-3 h-3 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none z-[120]" />
                    </div>
                    <button
                        onClick={fetchData}
                        className="p-2 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-xl transition-all active:scale-95 group/refresh"
                    >
                        <Search className={`w-3.5 h-3.5 text-slate-500 group-hover/refresh:text-purple-400 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* The Continuous Thread */}
            <div className="relative pl-12">
                {/* The Master Line - Solid & Clean */}
                <div className="absolute left-[47px] top-4 bottom-4 w-[1px] bg-white/5" />

                <div className="space-y-0 relative">
                    {loading && auditLogs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 space-y-4">
                            <div className="w-10 h-10 border border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
                        </div>
                    ) : timelineGroups.map((group, gIdx) => (
                        <div key={group.id} className="relative group/item animate-in fade-in slide-in-from-bottom-2 duration-500">
                            {/* Dot Container */}
                            <div className="absolute -left-[53px] top-6 w-11 flex justify-center z-20">
                                <div className={`
                                    w-2 h-2 rounded-full border border-slate-950 transition-all duration-500
                                    ${group.groupType === 'audit'
                                        ? 'bg-purple-500 shadow-[0_0_12px_rgba(168,85,247,0.6)]'
                                        : 'bg-slate-800 group-hover/item:bg-cyan-500 group-hover/item:shadow-[0_0_8px_rgba(34,211,238,0.4)]'}
                                `} />
                            </div>

                            {/* Date Separator - Vertical Anchor - Indented Slightly */}
                            {(gIdx === 0 || !isSameDay(group.startTime, timelineGroups[gIdx - 1].startTime)) && (
                                <div className="absolute -left-[108px] top-5 text-[9px] font-black text-slate-700 uppercase tracking-[0.3em] origin-right transform -rotate-90">
                                    {format(group.startTime, 'MMM dd')}
                                </div>
                            )}

                            {/* Main Event Content - NO CARDS, just horizontal rows */}
                            <div className={`
                                py-4 pr-4 transition-all duration-300 border-l border-transparent hover:border-purple-500/20 hover:bg-white/[0.01] rounded-r-3xl
                                ${expandedGroups.has(group.id) ? 'bg-white/[0.02]' : ''}
                            `}>
                                <div
                                    className="flex items-start justify-between cursor-pointer"
                                    onClick={() => group.items.length > 1 && toggleGroup(group.id)}
                                >
                                    <div className="flex gap-6 items-center">
                                        <div className="flex flex-col items-center justify-center w-12 shrink-0">
                                            <span className="text-[10px] font-black font-mono text-slate-600 tracking-tighter">
                                                {format(group.startTime, 'HH:mm')}
                                            </span>
                                            {group.items.length > 1 && !expandedGroups.has(group.id) && (
                                                <div className="mt-1 flex gap-0.5">
                                                    {[1, 2, 3].map(i => <div key={i} className="w-0.5 h-0.5 rounded-full bg-slate-800" />)}
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-1">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-1.5 rounded-lg border backdrop-blur-md transition-colors
                                                    ${group.groupType === 'audit'
                                                        ? 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                                                        : 'bg-slate-900 border-white/5 text-slate-500 group-hover/item:text-cyan-400 group-hover/item:border-cyan-500/20'}
                                                `}>
                                                    {getEventIcon(group.items[0])}
                                                </div>
                                                <h3 className={`text-xs font-bold tracking-tight transition-colors
                                                    ${group.groupType === 'audit' ? 'text-purple-100' : 'text-slate-400 group-hover/item:text-slate-200'}
                                                `}>
                                                    {group.summary}
                                                </h3>
                                                {group.groupType === 'audit' && (
                                                    <span className="text-[8px] font-black text-purple-500 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                                                        Authority
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {group.items.length > 1 && (
                                        <div className="flex items-center gap-3 pr-4">
                                            <span className="text-[9px] font-bold text-slate-700 uppercase tracking-widest transition-colors group-hover/item:text-slate-500">
                                                {group.items.length} Interactions
                                            </span>
                                            <div className={`transition-transform duration-300 ${expandedGroups.has(group.id) ? 'rotate-180 text-purple-500' : 'text-slate-700'}`}>
                                                <ChevronDown className="w-3.5 h-3.5" />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Expanded Detail Flow */}
                                {(expandedGroups.has(group.id) || group.items.length === 1) && (
                                    <div className="mt-2 ml-[104px] space-y-4 animate-in fade-in slide-in-from-top-2 duration-300 border-l border-white/5 pl-6 pb-2">
                                        {group.items.map((item, iIdx) => (
                                            <div key={item.id} className="group/detail relative">
                                                <div className="flex flex-col gap-2">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-[9px] font-bold font-mono text-slate-500 bg-black/40 px-1.5 py-0.5 rounded">
                                                                {format(item.timestamp, 'HH:mm:ss')}
                                                            </span>
                                                            <span className="text-[11px] font-bold text-slate-300 tracking-tight">{item.action}</span>
                                                            {item.severity === 'critical' && (
                                                                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                                                            )}
                                                        </div>
                                                        <span className="text-[8px] font-black text-slate-600 uppercase tracking-[0.2em]">
                                                            {item.category || 'System'}
                                                        </span>
                                                    </div>

                                                    {/* Clean Metadata Layout - Integrated into the thread */}
                                                    {(expandedGroups.has(group.id)) && (
                                                        <div className="mt-1 transition-all">
                                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-2 p-3 bg-black/20 rounded-2xl border border-white/5 overflow-hidden">
                                                                {Object.entries(item.metadata).map(([key, value]) => (
                                                                    value !== null && typeof value !== 'object' && (
                                                                        <div key={key} className="flex flex-col gap-0.5">
                                                                            <span className="text-[7px] font-black text-slate-600 uppercase tracking-[0.2em]">{key.replace(/_/g, ' ')}</span>
                                                                            <span className="text-[10px] font-bold text-slate-400 font-mono truncate" title={String(value)}>{String(value)}</span>
                                                                        </div>
                                                                    )
                                                                ))}
                                                                {item.actor && (
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <span className="text-[7px] font-black text-purple-600/60 uppercase tracking-[0.2em]">ACTOR SOURCE</span>
                                                                        <span className="text-[10px] font-black text-purple-400 font-mono truncate">{item.actor}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
