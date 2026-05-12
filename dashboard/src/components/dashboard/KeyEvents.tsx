'use client'

import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, ShieldAlert, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'

interface KeyEvent {
    id: string
    event_type: string
    severity: string
    timestamp: string
    metadata?: any
    agent_id?: string
}

interface KeyEventsProps {
    events: KeyEvent[]
}

export function KeyEvents({ events }: KeyEventsProps) {
    const getEventTitle = (event: KeyEvent) => {
        const typeMap: Record<string, string> = {
            'USB_DEVICE_CONNECTED': 'USB Device Connected',
            'USB_DEVICE_DISCONNECTED': 'USB Device Removed',
            'SCREENSHOT_TAKEN': 'Screenshot Captured',
            'NETWORK_CONNECTION': 'Network Connection',
            'BROWSER_HISTORY': 'Browser Activity',
            'FILE_TRANSFER': 'File Transfer',
            'PROCESS_START': 'Process Started',
            'PROCESS_STOP': 'Process Stopped'
        }
        return typeMap[event.event_type] || event.event_type?.replace(/_/g, ' ') || 'Unknown Event'
    }

    const getEventDesc = (event: KeyEvent) => {
        if (event.metadata?.description) return event.metadata.description
        if (event.metadata?.device_name) return `Device: ${event.metadata.device_name}`
        if (event.metadata?.url) return event.metadata.url
        if (event.metadata?.process_name) return `Process: ${event.metadata.process_name}`
        if (event.metadata?.remote_ip) return `→ ${event.metadata.remote_ip}`
        return 'Event detected'
    }

    const getSeverityStyle = (severity: string) => {
        switch (severity) {
            case 'critical': return {
                text: 'text-rose-400',
                bg: 'bg-rose-500/[0.06]',
                border: 'border-rose-500/10',
                dot: 'bg-rose-500',
                badge: 'CRIT'
            }
            case 'high': return {
                text: 'text-amber-400',
                bg: 'bg-amber-500/[0.06]',
                border: 'border-amber-500/10',
                dot: 'bg-amber-500',
                badge: 'HIGH'
            }
            default: return {
                text: 'text-sky-400',
                bg: 'bg-sky-500/[0.06]',
                border: 'border-sky-500/10',
                dot: 'bg-sky-500',
                badge: 'MED'
            }
        }
    }

    return (
        <div className="bg-[#080A14]/80 border border-white/[0.04] rounded-2xl p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-rose-500/[0.06] border border-rose-500/[0.08]">
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-200 tracking-tight">Threat Feed</h3>
                </div>
                {events.length > 0 && (
                    <span className="text-[10px] font-mono text-rose-400/60 bg-rose-500/[0.06] px-2 py-0.5 rounded border border-rose-500/[0.08]">
                        {events.length} flagged
                    </span>
                )}
            </div>

            <div className="space-y-2 flex-1 overflow-auto pr-1">
                {events.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="w-12 h-12 rounded-xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center mb-3">
                            <AlertTriangle className="w-5 h-5 text-slate-700" />
                        </div>
                        <p className="text-xs text-slate-500 mb-0.5">No threats detected</p>
                        <p className="text-[10px] text-slate-700">Critical & high events appear here</p>
                    </div>
                ) : (
                    events.slice(0, 5).map((event, i) => {
                        const style = getSeverityStyle(event.severity)
                        return (
                            <div key={event.id || i} className={`${style.bg} border ${style.border} rounded-xl p-3.5 hover:bg-white/[0.03] transition-all group cursor-pointer`}>
                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className={`w-1.5 h-1.5 rounded-full ${style.dot} flex-shrink-0 mt-0.5`} />
                                        <span className={`text-[11px] font-medium ${style.text} truncate`}>
                                            {getEventTitle(event)}
                                        </span>
                                    </div>
                                    <span className={`text-[8px] font-bold ${style.text} bg-white/[0.04] px-1.5 py-0.5 rounded flex-shrink-0`}>
                                        {style.badge}
                                    </span>
                                </div>
                                <p className="text-[10px] text-slate-500 truncate pl-3.5 mb-1.5">
                                    {getEventDesc(event)}
                                </p>
                                <div className="flex items-center gap-2 pl-3.5 text-[9px] text-slate-600 font-mono">
                                    <span>{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}</span>
                                    {event.agent_id && (
                                        <>
                                            <span className="text-slate-800">•</span>
                                            <span className="text-slate-700">{event.agent_id.substring(0, 8)}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>

            <Link href="/telemetry">
                <button className="w-full mt-4 py-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] hover:border-white/[0.08] text-[11px] font-medium text-slate-500 hover:text-slate-300 transition-all flex items-center justify-center gap-1.5">
                    Full Activity Feed <ArrowUpRight className="w-3 h-3" />
                </button>
            </Link>
        </div>
    )
}
