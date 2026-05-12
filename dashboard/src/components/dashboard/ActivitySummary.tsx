'use client'

import { Globe, Cpu, Chrome, HardDrive, ArrowUpRight } from 'lucide-react'
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
            sub: 'DNS / TCP / UDP',
            color: 'sky',
            barColor: 'bg-sky-500',
        },
        {
            icon: Cpu,
            label: 'Process',
            count: stats.processCount,
            detail: 'executions',
            sub: 'Start / Stop events',
            color: 'emerald',
            barColor: 'bg-emerald-500',
        },
        {
            icon: Chrome,
            label: 'Browser',
            count: stats.browserCount,
            detail: 'URLs visited',
            sub: 'History & search',
            color: 'violet',
            barColor: 'bg-violet-500',
        },
        {
            icon: HardDrive,
            label: 'File & USB',
            count: stats.fileCount,
            detail: 'events',
            sub: 'Transfers & access',
            color: 'amber',
            barColor: 'bg-amber-500',
        },
    ]

    return (
        <div className="bg-[#080A14]/80 border border-white/[0.04] rounded-2xl p-6 relative overflow-hidden">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-sm font-semibold text-slate-200 tracking-tight">Activity Breakdown</h3>
                    <p className="text-[10px] text-slate-600 font-mono mt-0.5">Last 24 hours — {total} total events</p>
                </div>
                <Link href="/telemetry">
                    <button className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 hover:text-sky-400 transition-colors">
                        View all <ArrowUpRight className="w-3 h-3" />
                    </button>
                </Link>
            </div>

            {/* Activity bars */}
            <div className="space-y-4">
                {categories.map(({ icon: Icon, label, count, detail, sub, color, barColor }) => {
                    const pct = total > 0 ? Math.max((count / total) * 100, 2) : 0

                    return (
                        <div key={label} className="group">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2.5">
                                    <div className={`p-1.5 rounded-md bg-${color}-500/[0.08] border border-${color}-500/[0.08]`}>
                                        <Icon className={`w-3.5 h-3.5 text-${color}-400`} />
                                    </div>
                                    <div>
                                        <span className="text-xs font-medium text-slate-300">{label}</span>
                                        <span className="text-[10px] text-slate-700 ml-2">{sub}</span>
                                    </div>
                                </div>
                                <div className="flex items-baseline gap-1.5 min-w-[120px] justify-end text-right">
                                    <span className="text-sm font-bold text-slate-200 tabular-nums">{count}</span>
                                    <span className="text-[10px] text-slate-600 w-[70px]">{detail}</span>
                                </div>
                            </div>

                            {/* Progress bar */}
                            <div className="h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                                <div
                                    className={`h-full ${barColor} rounded-full transition-all duration-700 ease-out opacity-70 group-hover:opacity-100`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Total footer */}
            <div className="mt-6 pt-4 border-t border-white/[0.04] flex items-center justify-between">
                <span className="text-[10px] text-slate-700 font-mono">TOTAL INGESTED</span>
                <span className="text-sm font-bold text-slate-300 tabular-nums">{total.toLocaleString()}</span>
            </div>
        </div>
    )
}
