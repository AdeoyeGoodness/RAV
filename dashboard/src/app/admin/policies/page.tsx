'use client'

import {
    ShieldCheck,
    Server,
    Clock,
    Lock,
    FileSearch,
    Cpu
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const SECTIONS = [
    {
        title: 'Agent Behavior Policies',
        icon: Cpu,
        items: [
            { label: 'Agent runs as a system service', status: 'Enforced' },
            { label: 'Service auto-starts on boot', status: 'Enforced' },
            { label: 'User-level tampering is prevented', status: 'Enforced' },
            { label: 'Agent binaries are integrity-checked', status: 'Enforced' },
        ]
    },
    {
        title: 'Data Collection Policies',
        icon: FileSearch,
        items: [
            { label: 'USB Insert/Removal Events', status: 'Monitored' },
            { label: 'Process Execution', status: 'Monitored' },
            { label: 'System Activity Metadata', status: 'Monitored' },
            { label: 'File Contents', status: 'Not Collected', type: 'neutral' },
            { label: 'Keystrokes', status: 'Not Collected', type: 'neutral' },
            { label: 'Personal User Data', status: 'Not Collected', type: 'neutral' },
        ]
    },
    {
        title: 'Store & Forward Policy',
        icon: Server,
        items: [
            { label: 'Events written to local encrypted storage', status: 'Active' },
            { label: 'No event loss on power failure', status: 'Guaranteed' },
            { label: 'Automatic retry until backend ack', status: 'Active' },
            { label: 'Local retention until sync', status: 'Enforced' },
        ]
    },
    {
        title: 'Log Retention Policy',
        icon: Clock,
        items: [
            { label: 'Compliance Logs Retention', status: '180 Days' },
            { label: 'Telemetry Logs Retention', status: '90 Days' },
            { label: 'Synced Events Pruning', status: 'Automatic' },
            { label: 'Legal Hold', status: 'Disabled', type: 'neutral' },
        ]
    },
    {
        title: 'Security & Access Control',
        icon: Lock,
        items: [
            { label: 'Role-Based Access Control (RBAC)', status: 'Active' },
            { label: 'Privileged Actions Restricted', status: 'Super Admin Only' },
            { label: 'API Token Authentication', status: 'Enforced' },
            { label: 'Token Revocation', status: 'Immediate' },
        ]
    },
    {
        title: 'Change Management',
        icon: ShieldCheck,
        items: [
            { label: 'Policy Changes Logged', status: 'Audited' },
            { label: 'Change History Retained', status: 'Audited' },
            { label: 'Actor Identity Recorded', status: 'Enforced' },
        ]
    }
]

export default function PoliciesPage() {
    const { user, isLoading } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (!isLoading) {
            if (!user || user.role !== 'super_admin') {
                router.push('/')
            }
        }
    }, [user, isLoading, router])

    if (isLoading || !user || user.role !== 'super_admin') {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin"></div>
                    <p className="text-slate-500 text-sm animate-pulse tracking-widest">RETRIEVING SECURITY PROTOCOLS...</p>
                </div>
            </div>
        )
    }
    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            {/* Header */}
            <div className="mb-10">
                <h1 className="text-3xl font-bold flex items-center gap-3">
                    <ShieldCheck className="h-10 w-10 text-blue-400" />
                    System Policies
                </h1>
                <p className="text-gray-400 mt-2 max-w-3xl">
                    Centralized enforcement rules governing agent behavior, data collection, retention, and security controls across the platform.
                </p>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {SECTIONS.map((section) => (
                    <div key={section.title} className="bg-gray-800 rounded-lg border border-gray-700 p-6 shadow-lg hover:shadow-xl transition-shadow">
                        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-700">
                            <section.icon className="h-6 w-6 text-blue-400" />
                            <h2 className="text-lg font-semibold text-white">{section.title}</h2>
                        </div>

                        <ul className="space-y-4">
                            {section.items.map((item) => (
                                <li key={item.label} className="flex items-center justify-between text-sm">
                                    <span className="text-gray-300">{item.label}</span>
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${item.type === 'neutral'
                                        ? 'bg-gray-700/50 text-gray-400 border-gray-600'
                                        : 'bg-emerald-900/30 text-emerald-400 border-emerald-800'
                                        }`}>
                                        {item.status}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="mt-12 pt-6 border-t border-gray-800">
                <div className="flex justify-between items-center text-xs text-gray-500">
                    <p>
                        System policies are enforced centrally and apply immediately across all registered agents unless otherwise specified.
                    </p>
                    <p className="font-mono">
                        Last modified by admin@rav.io on {new Date().toISOString().split('T')[0]} UTC
                    </p>
                </div>
            </div>
        </div>
    )
}
