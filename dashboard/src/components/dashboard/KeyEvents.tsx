'use client'

import { formatDistanceToNow } from 'date-fns'

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
    // Map event types to display titles
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

    // Get description from metadata
    const getEventDesc = (event: KeyEvent) => {
        if (event.metadata?.description) return event.metadata.description
        if (event.metadata?.device_name) return `Device: ${event.metadata.device_name}`
        if (event.metadata?.url) return event.metadata.url
        if (event.metadata?.process_name) return `Process: ${event.metadata.process_name}`
        if (event.metadata?.remote_ip) return `Connection to ${event.metadata.remote_ip}`
        return 'Event detected on endpoint'
    }

    // Get agent display name
    const getAgentName = (event: KeyEvent) => {
        return event.agent_id?.substring(0, 12) || 'Unknown Agent'
    }

    return (
        <div className="bg-[#131524]/80 backdrop-blur-xl border border-white/[0.08] rounded-3xl p-6 h-full relative overflow-hidden shadow-2xl flex flex-col">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                Key Events
                {events.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
            </h3>

            <div className="space-y-3 flex-1 overflow-auto pr-1">
                {events.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-sm">
                        No high-severity events detected
                    </div>
                ) : (
                    events.slice(0, 4).map((event, i) => (
                        <div key={event.id || i} className="group relative pl-4 pb-4 border-l border-white/10 last:border-0 last:pb-0">
                            <div className={`absolute left-[-5px] top-0 w-2.5 h-2.5 rounded-full ring-4 ring-[#131524] ${event.severity === 'critical' ? 'bg-red-500' :
                                    event.severity === 'high' ? 'bg-orange-500' :
                                        event.severity === 'medium' ? 'bg-amber-500' : 'bg-blue-500'
                                }`} />

                            <div className="bg-[#0A0B14]/50 hover:bg-[#1A1C30] p-3 rounded-xl border border-white/5 transition-all group-hover:border-white/10 group-hover:translate-x-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-xs font-bold uppercase tracking-wider ${event.severity === 'critical' ? 'text-red-400' :
                                            event.severity === 'high' ? 'text-orange-400' :
                                                event.severity === 'medium' ? 'text-amber-400' : 'text-blue-400'
                                        }`}>
                                        {getEventTitle(event)}
                                    </span>
                                    {event.severity === 'critical' && (
                                        <span className="text-[9px] font-bold bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded border border-red-500/20">CRITICAL</span>
                                    )}
                                </div>
                                <p className="text-[11px] text-slate-400 font-medium mb-1.5 line-clamp-2">
                                    {getEventDesc(event)}
                                </p>
                                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                                    <span>{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}</span>
                                    <span>•</span>
                                    <span className="bg-white/5 px-1.5 rounded text-slate-400">{getAgentName(event)}</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <button className="w-full mt-6 py-3 rounded-xl bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 text-xs font-bold text-blue-400 uppercase tracking-widest transition-all">
                View Full Activity
            </button>
        </div>
    )
}
