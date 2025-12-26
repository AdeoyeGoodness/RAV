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
            <div className="flex items-center justify-between bg-slate-900/40 p-4 rounded-xl border border-white/5">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/10 rounded-lg">
                        <Crosshair className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-slate-200">Session Narrative</h2>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest">Merged Audit & Telemetry Stream</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <select
                        className="bg-slate-950 border border-white/10 rounded px-2 py-1 text-xs text-slate-400 outline-none focus:border-purple-500"
                        value={filterAgent}
                        onChange={(e) => setFilterAgent(e.target.value)}
                    >
                        <option value="">Global Narrative</option>
                        {agents.map(a => (
                            <option key={a.agent_id} value={a.agent_id}>{a.hostname || a.agent_id.substring(0, 8)}</option>
                        ))}
                    </select>
                    <button onClick={fetchData} className="p-1 hover:bg-white/5 rounded transition-colors">
                        <Search className="w-4 h-4 text-slate-500" />
                    </button>
                </div>
            </div>

            {/* The Thread */}
            <div className="relative pl-8 space-y-4">
                {/* The Vertical Line */}
                <div className="absolute left-[39px] top-0 bottom-0 w-px bg-gradient-to-b from-purple-500/50 via-cyan-500/30 to-slate-800/20" />

                {loading ? (
                    <div className="text-center py-20 text-slate-500 animate-pulse">Syncing timeline streams...</div>
                ) : timelineGroups.map((group, gIdx) => (
                    <div key={group.id} className="relative group/line">
                        {/* Timeline Dot */}
                        <div className={`
              absolute -left-[5px] top-4 w-2.5 h-2.5 rounded-full z-10 border-2 border-slate-950
              ${group.groupType === 'audit' ? 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]' : 'bg-cyan-500/50'}
            `} />

                        {/* Date Separator */}
                        {(gIdx === 0 || !isSameDay(group.startTime, timelineGroups[gIdx - 1].startTime)) && (
                            <div className="absolute -left-20 top-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                                {format(group.startTime, 'MMM dd')}
                            </div>
                        )}

                        {/* Block Card */}
                        <div className={`
              rounded-xl p-4 border transition-all
              ${group.groupType === 'audit'
                                ? 'bg-purple-900/10 border-purple-500/20 shadow-lg shadow-purple-950/10'
                                : 'bg-slate-900/30 border-white/5 hover:border-white/10'}
            `}>
                            {/* Summary Header */}
                            <div
                                className={`flex items-center justify-between cursor-pointer ${group.items.length > 1 ? 'hover:opacity-80' : ''}`}
                                onClick={() => group.items.length > 1 && toggleGroup(group.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${group.groupType === 'audit' ? 'bg-purple-500/20' : 'bg-slate-800/50'}`}>
                                        {getEventIcon(group.items[0])}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono text-slate-500">{format(group.startTime, 'HH:mm')}</span>
                                            <span className={`text-[10px] font-bold uppercase tracking-widest ${group.groupType === 'audit' ? 'text-purple-400' : 'text-slate-500'}`}>
                                                {group.groupType === 'audit' ? 'AUTHORITY ACTION' : 'CONTEXT'}
                                            </span>
                                        </div>
                                        <h3 className="text-sm font-medium text-slate-200">{group.summary}</h3>
                                    </div>
                                </div>

                                {group.items.length > 1 && (
                                    <div className="flex items-center gap-2 text-slate-500">
                                        <span className="text-[10px] font-mono">{format(group.endTime, 'HH:mm')}</span>
                                        {expandedGroups.has(group.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    </div>
                                )}
                            </div>

                            {/* Expansion Details */}
                            {(expandedGroups.has(group.id) || group.items.length === 1) && (
                                <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
                                    {group.items.map((item, iIdx) => (
                                        <div key={item.id} className="text-xs flex gap-3 group/item">
                                            <span className="text-slate-600 font-mono w-10 shrink-0">{format(item.timestamp, 'HH:mm:ss')}</span>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-300">{item.action}</span>
                                                    {item.type === 'telemetry' && (
                                                        <span className="text-[9px] text-slate-600 font-mono italic capitalize">{item.category}</span>
                                                    )}
                                                </div>
                                                {item.type === 'audit' && (
                                                    <div className="mt-1 flex gap-2">
                                                        <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded text-[9px] font-bold uppercase">
                                                            Actor: {item.actor}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Simple Metadata Preview for specific findings */}
                                                {(item.action.includes('LOGIN') || item.action.includes('ERROR') || item.severity === 'critical') && (
                                                    <pre className="mt-2 text-[10px] bg-black/40 p-2 rounded text-cyan-400/70 overflow-auto">
                                                        {JSON.stringify(item.metadata, null, 1)}
                                                    </pre>
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
    )
}
