'use client'

import { AlertTriangle, AlertOctagon } from 'lucide-react'

export function KeyEvents() {
    const events = [
        {
            severity: 'critical',
            title: 'Sensitive File Transfer',
            desc: 'User initiated a large file transfer of sensitive data to an external cloud storage service.',
            time: '3 mins ago',
            agent: 'Laptop-A12',
            user: 'john.doe@example.com'
        },
        {
            severity: 'warning',
            title: 'Unsanctioned USB Usage',
            desc: 'An unauthorized USB device was connected to Workstation-A17.',
            time: '15 mins ago',
            agent: 'Workstation-A17',
            user: 'jane.smith@example.com'
        },
        {
            severity: 'info',
            title: 'OneDriveUpdater.exe',
            desc: 'Process OneDriveUpdater.exe started on Server-B03.',
            time: '30 mins ago',
            agent: 'Server-B03',
            user: null
        },
        {
            severity: 'info',
            title: 'Games are running which...',
            desc: 'Multiple gaming applications detected running during business hours on Brics vec.',
            time: '1 hour ago',
            agent: 'Brics vec',
            user: 'alex.green@example.com'
        },
        {
            severity: 'critical',
            title: 'Malware Detected',
            desc: 'Malicious software detected and quarantined on Laptop-C22.',
            time: '2 hours ago',
            agent: 'Laptop-C22',
            user: 'sarah.jones@example.com'
        },
        {
            severity: 'warning',
            title: 'Failed Login Attempts',
            desc: 'Multiple failed login attempts for user "admin" on VPN gateway.',
            time: '3 hours ago',
            agent: 'VPN Gateway',
            user: null
        },
    ];

    return (
        <div className="bg-[#131524]/80 backdrop-blur-xl border border-white/[0.08] rounded-3xl p-6 h-full relative overflow-hidden shadow-2xl">
            <h3 className="text-base font-bold text-white mb-6 flex items-center gap-2">
                Key Events
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            </h3>

            <div className="space-y-4">
                {events.map((event, i) => (
                    <div key={i} className="group relative pl-4 pb-4 border-l border-white/10 last:border-0 last:pb-0">
                        <div className={`absolute left-[-5px] top-0 w-2.5 h-2.5 rounded-full ring-4 ring-[#131524] ${event.severity === 'critical' ? 'bg-red-500' :
                                event.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
                            }`} />

                        <div className="bg-[#0A0B14]/50 hover:bg-[#1A1C30] p-3 rounded-xl border border-white/5 transition-all group-hover:border-white/10 group-hover:translate-x-1">
                            <div className="flex items-center justify-between mb-1">
                                <span className={`text-xs font-bold uppercase tracking-wider ${event.severity === 'critical' ? 'text-red-400' :
                                        event.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                                    }`}>
                                    {event.title}
                                </span>
                                {event.severity === 'critical' && (
                                    <span className="text-[9px] font-bold bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded border border-red-500/20">DETECTED</span>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium mb-1.5 line-clamp-2">
                                {event.desc}
                            </p>
                            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                                <span>{event.time}</span>
                                <span>•</span>
                                <span className="bg-white/5 px-1.5 rounded text-slate-400">{event.agent}</span>
                                {event.user && (
                                    <>
                                        <span>•</span>
                                        <span className="bg-white/5 px-1.5 rounded text-slate-400 max-w-[80px] truncate">{event.user}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <button className="w-full mt-6 py-3 rounded-xl bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 text-xs font-bold text-blue-400 uppercase tracking-widest transition-all">
                View Full Activity
            </button>
        </div>
    )
}
