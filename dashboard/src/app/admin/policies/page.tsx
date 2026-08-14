'use client'

import {
    ShieldCheck,
    Server,
    Clock,
    Lock,
    FileSearch,
    Cpu,
    ArrowLeft
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { Panel, PanelHead, SectionHead, StatusPill, Eyebrow } from '@/components/ct/primitives'

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
            <div className="min-h-screen bg-ct-bg flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 rounded-full animate-spin" style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }} />
                    <span className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.24em' }}>Retrieving security protocols</span>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden ml-64">
                <Header />
                <main className="flex-1 overflow-auto p-8 mt-20 space-y-6">
                    <div className="flex items-start gap-3">
                        <button
                            onClick={() => router.back()}
                            className="p-2 rounded-sm bg-ct-panel border border-ct-line hover:bg-ct-panel-hi text-ct-ink3 hover:text-ct-ink transition-colors mt-1"
                            title="Go Back"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </button>
                        <div className="flex-1">
                            <SectionHead
                                eyebrow="Platform / Policies"
                                title="System Policies"
                            />
                            <p className="text-ct-ink3 text-[13px] -mt-2 max-w-3xl">
                                Centralized enforcement rules governing agent behavior, data collection, retention, and security controls across the platform.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {SECTIONS.map((section) => (
                            <Panel key={section.title}>
                                <PanelHead
                                    title={
                                        <span className="flex items-center gap-2">
                                            <section.icon className="w-4 h-4 text-ct-accent" />
                                            {section.title}
                                        </span>
                                    }
                                />
                                <ul className="divide-y divide-ct-line">
                                    {section.items.map((item) => (
                                        <li key={item.label} className="flex items-center justify-between px-5 py-3 text-[13px]">
                                            <span className="text-ct-ink2">{item.label}</span>
                                            <StatusPill tone={item.type === 'neutral' ? 'idle' : 'ok'} dot={false}>
                                                {item.status}
                                            </StatusPill>
                                        </li>
                                    ))}
                                </ul>
                            </Panel>
                        ))}
                    </div>

                    <div className="mt-8 pt-6 border-t border-ct-line">
                        <div className="flex justify-between items-center pb-4">
                            <Eyebrow>Enforcement is central &amp; immediate across all agents</Eyebrow>
                            <span className="font-mono text-[10px] text-ct-ink3" style={{ letterSpacing: '0.14em' }}>
                                Last modified by admin@rav.io on {new Date().toISOString().split('T')[0]} UTC
                            </span>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    )
}
