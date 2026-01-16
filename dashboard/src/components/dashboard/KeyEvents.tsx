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
                        </div >
                    </div >

        {/* Item 4 */ }
        < div className = "relative" >
                        <div className="absolute -left-[29px] top-1 w-3 h-3 rounded-full bg-slate-500 border-2 border-[#12121A]" />
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-200">Games are running which...</span>
                            </div>
                             <div className="text-[10px] text-slate-500 font-mono">
                                1 hour ago • Brics vec • <span className="bg-white/5 px-1 rounded text-slate-400">PROC_START</span>
                            </div>
                        </div>
                    </div >
                </div >
            </div >

        <button className="w-full mt-6 py-2 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-600/20 rounded-lg text-xs font-bold text-blue-400 transition-colors uppercase tracking-wide">
            View Full Activity
        </button>
        </div >
    )
}
