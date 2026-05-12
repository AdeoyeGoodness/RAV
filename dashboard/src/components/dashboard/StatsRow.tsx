'use client'

import { Monitor, Activity, Shield, Zap, Eye, Camera } from 'lucide-react'
import Link from 'next/link'

interface StatsRowProps {
    stats: {
        agents: number
        events24h: number
        warnings: number
        uniqueIps: number
        screenshots: number
        criticalCount: number
        highCount: number
        mediumCount: number
        lowCount: number
    }
}

export function StatsRow({ stats }: StatsRowProps) {


    const cards = [
        {
            icon: Monitor,
            value: stats.agents,
            label: 'Endpoints',
            sub: stats.agents > 0 ? 'Reporting' : 'Awaiting',
            accent: 'sky',
            href: '/devices'
        },
        {
            icon: Activity,
            value: stats.events24h,
            label: 'Events',
            sub: '24h window',
            accent: 'violet',
            href: '/telemetry'
        },
        {
            icon: Eye,
            value: stats.uniqueIps,
            label: 'Unique IPs',
            sub: 'Tracked',
            accent: 'teal',
            href: '/telemetry'
        },
        {
            icon: Camera,
            value: stats.screenshots,
            label: 'Captures',
            sub: 'Screenshots',
            accent: 'indigo',
            href: '/telemetry'
        },
    ]

    return (
        <div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                {cards.map(({ icon: Icon, value, label, sub, accent, href }) => (
                    <Link key={label} href={href}>
                        <div className="group relative bg-[#080A14]/80 rounded-2xl p-5 border border-white/[0.04] hover:border-white/[0.08] transition-all cursor-pointer overflow-hidden">
                            {/* Subtle corner accent */}
                            <div className={`absolute top-0 right-0 w-20 h-20 bg-${accent}-500/[0.03] blur-2xl rounded-full -translate-y-1/2 translate-x-1/2 group-hover:bg-${accent}-500/[0.06] transition-all`} />

                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-4">
                                    <div className={`p-2 rounded-lg bg-${accent === 'sky' ? 'sky' : accent === 'violet' ? 'violet' : accent === 'teal' ? 'teal' : 'indigo'}-500/[0.08] border border-${accent === 'sky' ? 'sky' : accent === 'violet' ? 'violet' : accent === 'teal' ? 'teal' : 'indigo'}-500/[0.1]`}>
                                        <Icon className={`w-4 h-4 text-${accent === 'sky' ? 'sky' : accent === 'violet' ? 'violet' : accent === 'teal' ? 'teal' : 'indigo'}-400`} />
                                    </div>
                                </div>

                                <div className="text-3xl font-bold text-white tracking-tight tabular-nums mb-1">
                                    {value.toLocaleString()}
                                </div>
                                <div className="text-xs text-slate-500 font-medium">{label}</div>
                                <div className="text-[10px] text-slate-700 font-mono mt-0.5">{sub}</div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    )
}
