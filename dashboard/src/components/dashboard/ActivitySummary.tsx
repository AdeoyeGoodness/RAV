'use client'

import { Globe, Cpu, Chrome, FileCode } from 'lucide-react'
import Link from 'next/link'

interface ActivitySummaryProps {
    stats: {
        networkCount: number
        processCount: number
        fileCount: number
        browserCount: number
    }
}

export function ActivitySummary({ stats }: ActivitySummaryProps) {
    const total = stats.networkCount + stats.processCount + stats.fileCount + stats.browserCount

    const categories = [
        {
            icon: Globe,
            label: 'Network',
            count: stats.networkCount,
            detail: 'connections',
            sub: 'Tracked endpoints',
            accent: 'text-sky-400',
            accentBg: 'bg-sky-500/8',
            accentBorder: 'border-sky-500/10',
            dotColor: 'bg-sky-500',
        },
        {
            icon: Cpu,
            label: 'Process',
            count: stats.processCount,
            detail: 'executions',
            sub: 'Monitored processes',
            accent: 'text-emerald-400',
            accentBg: 'bg-emerald-500/8',
            accentBorder: 'border-emerald-500/10',
            dotColor: 'bg-emerald-500',
        },
        {
            icon: Chrome,
            label: 'Browser',
            count: stats.browserCount,
            detail: 'URLs visited',
            sub: 'History tracked',
            accent: 'text-violet-400',
            accentBg: 'bg-violet-500/8',
            accentBorder: 'border-violet-500/10',
            dotColor: 'bg-violet-500',
        },
        {
            icon: FileCode,
            label: 'File',
            count: stats.fileCount,
            detail: 'events',
            sub: 'Transfers monitored',
            accent: 'text-pink-400',
            accentBg: 'bg-pink-500/8',
            accentBorder: 'border-pink-500/10',
            dotColor: 'bg-pink-500',
        },
    ]

    return (
        <div className="bg-[#0C0E1C]/90 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 relative overflow-hidden shadow-xl">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-slate-200 tracking-tight">Activity Timeline</h3>
                    <span className="text-[10px] font-mono text-slate-600">Last 30 min</span>
                </div>
                <span className="text-[10px] font-mono text-slate-600 tabular-nums">
                    {total} total events
                </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {categories.map(({ icon: Icon, label, count, detail, sub, accent, accentBg, accentBorder, dotColor }) => (
                    <div
                        key={label}
                        className={`p-4 rounded-xl bg-[#080A14]/60 border ${accentBorder} hover:border-opacity-50 transition-all group`}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className={`p-2 rounded-lg ${accentBg} ${accent} transition-colors`}>
                                <Icon className="w-4 h-4" />
                            </div>
                            <span className="text-xs font-medium text-slate-300">{label} Activity</span>
                        </div>
                        <div className="space-y-2.5 mb-4">
                            <div className="flex items-center gap-2.5">
                                <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                <span className="text-[11px] text-slate-400">
                                    <span className="text-slate-300 font-mono tabular-nums">{count}</span> {detail}
                                </span>
                            </div>
                            <div className="flex items-center gap-2.5">
                                <div className={`w-1.5 h-1.5 rounded-full ${dotColor} opacity-30`} />
                                <span className="text-[11px] text-slate-600">{sub}</span>
                            </div>
                        </div>
                        <Link href="/telemetry">
                            <button className={`w-full py-2 ${accentBg} border ${accentBorder} rounded-lg text-[11px] font-medium ${accent} transition-all hover:opacity-80`}>
                                View Details
                            </button>
                        </Link>
                    </div>
                ))}
            </div>
        </div>
    )
}
