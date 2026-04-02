'use client'

import { formatDistanceToNow } from 'date-fns'
import { AlertOctagon } from 'lucide-react'
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
        if (event.metadata?.remote_ip) return `Connection to ${event.metadata.remote_ip}`
        return 'Event detected on endpoint'
    }

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'critical': return 'text-rose-400'
            case 'high': return 'text-amber-400'
            case 'medium': return 'text-yellow-400'
            default: return 'text-sky-400'
        }
    }

    const getSeverityDot = (severity: string) => {
        switch (severity) {
            case 'critical': return 'bg-rose-500'
            case 'high': return 'bg-amber-500'
            case 'medium': return 'bg-yellow-500'
            default: return 'bg-sky-500'
        }
    }

    return (
        <div className="bg-[#0C0E1C]/90 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 h-full relative overflow-hidden shadow-xl flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-200 tracking-tight">Key Events</h3>
                {events.length > 0 && (
                    <span className="text-[10px] font-mono text-slate-600 tabular-nums">{events.length} flagged</span>
                )}
            </div>

            <div className="space-y-2.5 flex-1 overflow-auto pr-1">
                {events.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                        <div className="w-10 h-10 rounded-xl bg-slate-800/50 border border-white/[0.04] flex items-center justify-center mb-3">
                            <AlertOctagon className="w-4 h-4 text-slate-600" />
                        </div>
                        <p className="text-xs text-slate-500 mb-0.5">No high-severity events</p>
                        <p className="text-[10px] text-slate-700">Critical and high events appear here</p>
                    </div>
                ) : (
                    events.slice(0, 4).map((event, i) => (
                        <div key={event.id || i} className="group relative pl-4 pb-3 border-l border-white/[0.06] last:border-0 last:pb-0">
                            <div className={`absolute left-[-3px] top-1.5 w-1.5 h-1.5 rounded-full ${getSeverityDot(event.severity)}`} />

                            <div className="bg-[#080A14]/60 hover:bg-[#0E1020] p-3 rounded-xl border border-white/[0.04] transition-all">
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-[11px] font-medium ${getSeverityColor(event.severity)}`}>
                                        {getEventTitle(event)}
                                    </span>
                                    {event.severity === 'critical' && (
                                        <span className="text-[8px] font-semibold bg-rose-500/8 text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/15">CRITICAL</span>
                                    )}
                                </div>
                                <p className="text-[10px] text-slate-500 mb-1.5 line-clamp-1">
                                    {getEventDesc(event)}
                                </p>
                                <div className="flex items-center gap-2 text-[9px] text-slate-600 font-mono">
                                    <span>{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}</span>
                                    <span className="text-slate-700">•</span>
                                    <span className="bg-white/[0.03] px-1 rounded">{event.agent_id?.substring(0, 8)}</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <Link href="/telemetry">
                <button className="w-full mt-4 py-2.5 rounded-xl bg-[#080A14]/60 hover:bg-[#0E1020] border border-white/[0.06] text-[11px] font-medium text-slate-500 hover:text-slate-300 transition-all">
                    View Full Activity
                </button>
            </Link>
        </div>
    )
}
