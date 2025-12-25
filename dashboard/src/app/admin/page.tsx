'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus, ShieldCheck, Activity, Key, ChevronRight, Search, Loader2, UserPlus, ExternalLink, Mail, User as UserIcon, Copy, Check, Trash2, Undo2 } from 'lucide-react'
import { getOrganizations, createOrganization, updateOrganizationStatus, deleteOrganization, restoreOrganizationData, register, Organization } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { useAuth } from '@/contexts/AuthContext'



export default function AdminPage() {
    const { user } = useAuth()
    const router = useRouter()
    const [organizations, setOrganizations] = useState<Organization[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')

    // Org Creation State
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [newOrg, setNewOrg] = useState({ name: '', enrollment_token: '', max_agents: 1000, token_expiry: '' })

    // Admin Creation State
    const [isAdminModalOpen, setIsAdminModalOpen] = useState(false)
    const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)
    const [newAdmin, setNewAdmin] = useState({ email: '', password: '', full_name: '' })
    const [copiedTokenIds, setCopiedTokenIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (user) {
            if (user.role !== 'super_admin') {
                router.push('/')
                return
            }
            loadData()
        }
    }, [user, router])

    const loadData = async () => {
        try {
            const data = await getOrganizations()
            setOrganizations(data)
        } catch (error) {
            console.error('Failed to load organizations:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            // Calculate expiry time: Selected Date + Current Time
            let finalExpiry: string | undefined = undefined;
            if (newOrg.token_expiry) {
                const now = new Date();
                const selectedDate = new Date(newOrg.token_expiry);
                // Set the time of the selected date to match the current time
                selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
                finalExpiry = selectedDate.toISOString();
            }

            await createOrganization({
                ...newOrg,
                token_expiry: finalExpiry
            })
            setNewOrg({ name: '', enrollment_token: '', max_agents: 1000, token_expiry: '' })
            setIsModalOpen(false)
            loadData()
        } catch (error) {
            console.error(error)
            alert('Failed to create organization')
        }
    }

    const handleCreateAdmin = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedOrg) return
        try {
            await register({
                ...newAdmin,
                organization_id: selectedOrg.id,
                role: 'org_admin'
            })
            alert(`Admin user created successfully for ${selectedOrg.name}`)
            setIsAdminModalOpen(false)
            setNewAdmin({ email: '', password: '', full_name: '' })
        } catch (error) {
            alert('Failed to create admin user. (Check if email already exists)')
        }
    }

    const switchContext = (orgId: string | null, orgName: string) => {
        if (orgId) {
            localStorage.setItem('rav_organization_id', orgId)
            localStorage.setItem('rav_organization_name', orgName)
            alert(`Switched context to ${orgName}`)
        } else {
            localStorage.removeItem('rav_organization_id')
            localStorage.removeItem('rav_organization_name')
        }
        router.push('/')
    }

    const toggleStatus = async (orgId: string, currentStatus: string) => {
        const newStatus = currentStatus === 'active' ? 'paused' : 'active'
        try {
            await updateOrganizationStatus(orgId, newStatus)
            loadData()
        } catch (error) {
            alert('Failed to update status')
        }
    }

    // Delete Modal State
    const [deleteModal, setDeleteModal] = useState<{
        isOpen: boolean;
        org: Organization | null;
        inputValue: string;
    }>({ isOpen: false, org: null, inputValue: '' })

    const handleDelete = (org: Organization) => {
        setDeleteModal({ isOpen: true, org, inputValue: '' })
    }

    const confirmDelete = async () => {
        if (!deleteModal.org) return

        try {
            await deleteOrganization(deleteModal.org.id)
            setDeleteModal({ isOpen: false, org: null, inputValue: '' })
            loadData()
        } catch (error) {
            alert('Failed to delete organization')
        }
    }

    const handleRestore = async (org: Organization) => {
        if (!confirm(`Restore deleted data for "${org.name}"?\n\nThis will recover all soft-deleted Agents, Events, and Files.\n\nType "RESTORE" to confirm.`)) return

        try {
            const res = await restoreOrganizationData(org.id)
            alert(`Restoration Successful:\nAgents: ${res.restored.agents}\nEvents: ${res.restored.events}\nFiles: ${res.restored.files}`)
            loadData()
        } catch (error) {
            alert('Failed to restore data')
        }
    }

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text)
        setCopiedTokenIds(prev => new Set(prev).add(id))
        setTimeout(() => {
            setCopiedTokenIds(prev => {
                const newSet = new Set(prev)
                newSet.delete(id)
                return newSet
            })
        }, 2000)
    }

    const generateToken = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        let token = 'RAV-'
        for (let i = 0; i < 16; i++) {
            if (i > 0 && i % 4 === 0) token += '-'
            token += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        setNewOrg(prev => ({ ...prev, enrollment_token: token }))
    }

    // Auto-generate token when modal opens
    useEffect(() => {
        if (isModalOpen) {
            generateToken()
        }
    }, [isModalOpen])

    const filteredOrgs = organizations.filter(org =>
        org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        org.enrollment_token.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="flex h-screen transition-colors" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <Sidebar />
            <div className="flex-1 ml-64">
                <Header />
                <main className="pt-20 p-8 overflow-y-auto h-full">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex justify-between items-center mb-8">
                            <div>
                                <h1 className="text-3xl font-bold mb-2 transition-colors" style={{ color: 'var(--text-primary)' }}>Organization Management</h1>
                                <p className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Global oversight of all enterprise tenants and licenses</p>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="flex items-center px-4 py-2 rounded-lg font-semibold text-white cyber-glow transition-all transform hover:scale-105"
                                style={{ background: 'linear-gradient(to right, var(--accent-cyan), var(--accent-purple))' }}
                            >
                                <Plus className="w-5 h-5 mr-2" />
                                New Organization
                            </button>
                        </div>

                        {/* Stats Overview */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                            <div className="p-6 rounded-2xl border backdrop-blur-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                                <div className="flex items-center space-x-4">
                                    <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-500">
                                        <Building2 className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Total Orgs</p>
                                        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{organizations.length}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="p-6 rounded-2xl border backdrop-blur-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                                <div className="flex items-center space-x-4">
                                    <div className="p-3 rounded-xl bg-purple-500/10 text-purple-500">
                                        <ShieldCheck className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Active Tokens</p>
                                        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{organizations.filter(o => o.status === 'active').length}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="p-6 rounded-2xl border backdrop-blur-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                                <div className="flex items-center space-x-4">
                                    <div className="p-3 rounded-xl bg-yellow-500/10 text-yellow-500">
                                        <Activity className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Platform Status</p>
                                        <p className="text-2xl font-bold text-green-500">Operational</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* List */}
                        <div className="rounded-2xl border overflow-hidden transition-all" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                            <div className="p-4 border-b flex items-center" style={{ borderColor: 'var(--border-color)' }}>
                                <Search className="w-5 h-5 mr-3" style={{ color: 'var(--text-tertiary)' }} />
                                <input
                                    type="text"
                                    placeholder="Filter by name or token..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="bg-transparent border-none focus:outline-none w-full text-sm"
                                    style={{ color: 'var(--text-primary)' }}
                                />
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-left text-xs uppercase tracking-wider" style={{ backgroundColor: 'rgba(255,255,255,0.02)', color: 'var(--text-tertiary)' }}>
                                            <th className="px-6 py-4">Organization Name</th>
                                            <th className="px-6 py-4">Quota</th>
                                            <th className="px-6 py-4">Expiry</th>
                                            <th className="px-6 py-4">Status</th>
                                            <th className="px-6 py-4">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y border-t" style={{ borderColor: 'var(--border-color)' }}>
                                        {loading ? (
                                            <tr>
                                                <td colSpan={5} className="px-6 py-12 text-center">
                                                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-cyan-500" />
                                                    <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading organizations...</p>
                                                </td>
                                            </tr>
                                        ) : filteredOrgs.map(org => (
                                            <tr key={org.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center">
                                                        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center mr-3 font-bold text-xs" style={{ color: 'var(--accent-cyan)' }}>
                                                            {org.name.charAt(0)}
                                                        </div>
                                                        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{org.name}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                                    {org.max_agents} Agents
                                                </td>
                                                <td className="px-6 py-4 text-xs font-mono" style={{ color: org.token_expiry && new Date(org.token_expiry) < new Date() ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                                                    {org.token_expiry ? new Date(org.token_expiry).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2 py-1 rounded-full text-[10px] uppercase font-bold ${org.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                                        {org.status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center space-x-2">
                                                        <button
                                                            onClick={() => { setSelectedOrg(org); setIsAdminModalOpen(true); }}
                                                            className="p-2 rounded-lg border transition-all hover:opacity-70"
                                                            style={{ backgroundColor: 'rgba(0, 217, 255, 0.1)', borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' }}
                                                            title="Onboard Organization Admin"
                                                        >
                                                            <UserPlus className="w-4 h-4" />
                                                        </button>
                                                        {/* Context Switching Removed for Security */}
                                                        <button
                                                            onClick={() => toggleStatus(org.id, org.status)}
                                                            className="text-xs px-3 py-2 rounded-lg border transition-all hover:bg-white/10"
                                                            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                                                        >
                                                            {org.status === 'active' ? 'Pause' : 'Activate'}
                                                        </button>
                                                        <button
                                                            onClick={() => copyToClipboard(org.enrollment_token, org.id)}
                                                            className="p-2 rounded-lg border transition-all hover:opacity-70"
                                                            style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                                                            title="Copy Enrollment Token"
                                                        >
                                                            {copiedTokenIds.has(org.id) ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(org)}
                                                            className="p-2 rounded-lg border transition-all hover:bg-red-500/20 hover:border-red-500"
                                                            style={{ backgroundColor: 'rgba(255, 0, 0, 0.05)', borderColor: 'var(--border-color)', color: 'var(--accent-red)' }}
                                                            title="Delete Organization"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleRestore(org)}
                                                            className="p-2 rounded-lg border transition-all hover:bg-green-500/20 hover:border-green-500"
                                                            style={{ backgroundColor: 'rgba(0, 255, 0, 0.05)', borderColor: 'var(--border-color)', color: 'var(--accent-green)' }}
                                                            title="Restore Deleted Data"
                                                        >
                                                            <Undo2 className="w-4 h-4 text-green-500" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </main>
            </div>

            {/* Create Org Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border p-8 shadow-2xl transition-all" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                        <h2 className="text-xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Register New Organization</h2>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Organization Name</label>
                                <input
                                    type="text"
                                    required
                                    value={newOrg.name}
                                    onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                                    className="w-full px-4 py-3 rounded-xl border bg-black/20 focus:outline-none transition-all text-sm"
                                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Enrollment Token</label>
                                <div className="relative flex items-center">
                                    <Key className="absolute left-3 w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                                    <input
                                        type="text"
                                        required
                                        value={newOrg.enrollment_token}
                                        onChange={(e) => setNewOrg({ ...newOrg, enrollment_token: e.target.value })}
                                        className="w-full pl-10 pr-12 py-3 rounded-xl border bg-black/20 focus:outline-none transition-all text-sm font-mono"
                                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={generateToken}
                                        className="absolute right-3 p-1 rounded-lg hover:bg-white/10 transition-colors"
                                        title="Regenerate Token"
                                    >
                                        <Activity className="w-4 h-4 text-cyan-500" />
                                    </button>
                                </div>
                                <p className="text-[10px] mt-1 text-gray-500">Auto-generated secure token for agent enrollment.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Max Agents</label>
                                    <input
                                        type="number"
                                        value={newOrg.max_agents}
                                        onChange={(e) => setNewOrg({ ...newOrg, max_agents: parseInt(e.target.value) })}
                                        className="w-full px-4 py-3 rounded-xl border bg-black/20 focus:outline-none transition-all text-sm"
                                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Expiry</label>
                                    <input
                                        type="date"
                                        required
                                        min={new Date().toISOString().split('T')[0]}
                                        value={newOrg.token_expiry}
                                        onChange={(e) => setNewOrg({ ...newOrg, token_expiry: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border bg-black/20 focus:outline-none transition-all text-sm"
                                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                    />
                                </div>
                            </div>
                            <div className="flex space-x-3 mt-8">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="flex-1 py-3 rounded-xl font-semibold border transition-all hover:bg-white/5"
                                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-3 rounded-xl font-bold text-white cyber-glow transition-all"
                                    style={{ background: 'linear-gradient(to right, var(--accent-cyan), var(--accent-purple))' }}
                                >
                                    Create
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Create Admin Modal */}
            {isAdminModalOpen && selectedOrg && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border p-8 shadow-2xl transition-all" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                        <div className="mb-6">
                            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Onboard Tenant Admin</h2>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Set up the primary administrator for <span className="text-white font-semibold">{selectedOrg.name}</span></p>
                        </div>
                        <form onSubmit={handleCreateAdmin} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Full Name</label>
                                <div className="relative">
                                    <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                                    <input
                                        type="text"
                                        required
                                        value={newAdmin.full_name}
                                        onChange={(e) => setNewAdmin({ ...newAdmin, full_name: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border bg-black/20 focus:outline-none transition-all text-sm"
                                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Email Address</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                                    <input
                                        type="email"
                                        required
                                        value={newAdmin.email}
                                        onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border bg-black/20 focus:outline-none transition-all text-sm"
                                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Initial Password</label>
                                <div className="relative">
                                    <Key className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
                                    <input
                                        type="password"
                                        required
                                        value={newAdmin.password}
                                        onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border bg-black/20 focus:outline-none transition-all text-sm"
                                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                                    />
                                </div>
                            </div>
                            <div className="flex space-x-3 mt-8">
                                <button
                                    type="button"
                                    onClick={() => setIsAdminModalOpen(false)}
                                    className="flex-1 py-3 rounded-xl font-semibold border transition-all hover:bg-white/5"
                                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-3 rounded-xl font-bold text-white cyber-glow transition-all"
                                    style={{ background: 'linear-gradient(to right, var(--accent-cyan), var(--accent-purple))' }}
                                >
                                    Create Account
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* Delete Confirmation Modal */}
            {deleteModal.isOpen && deleteModal.org && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-all duration-300">
                    <div className="w-full max-w-md rounded-2xl border p-8 shadow-2xl relative overflow-hidden" style={{ backgroundColor: '#0F1629', borderColor: 'rgba(239, 68, 68, 0.3)' }}>

                        {/* Red Glow Effect */}
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-red-900" />

                        <div className="mb-6 text-center">
                            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                                <Trash2 className="w-8 h-8 text-red-500" />
                            </div>
                            <h2 className="text-xl font-bold text-white mb-2">Delete Organization?</h2>
                            <p className="text-sm text-gray-400">
                                This action is <span className="text-red-400 font-semibold">irreversible</span>.
                                It will permanently destroy <strong>{deleteModal.org.name}</strong> and all associated agents, users, and events.
                            </p>
                        </div>

                        <div className="mb-6">
                            <label className="block text-xs font-semibold uppercase tracking-wider mb-2 text-gray-500">
                                Type <span className="text-white select-all">{deleteModal.org.name}</span> to confirm
                            </label>
                            <input
                                type="text"
                                value={deleteModal.inputValue}
                                onChange={(e) => setDeleteModal(prev => ({ ...prev, inputValue: e.target.value }))}
                                className="w-full px-4 py-3 rounded-xl border bg-black/40 focus:outline-none transition-all text-sm font-mono text-center"
                                style={{
                                    borderColor: deleteModal.inputValue === deleteModal.org.name ? 'var(--accent-red)' : 'var(--border-color)',
                                    color: 'var(--text-primary)'
                                }}
                                placeholder={deleteModal.org.name}
                                autoFocus
                            />
                        </div>

                        <div className="flex space-x-3">
                            <button
                                onClick={() => setDeleteModal({ isOpen: false, org: null, inputValue: '' })}
                                className="flex-1 py-3 rounded-xl font-semibold border transition-all hover:bg-white/5 text-gray-400 hover:text-white"
                                style={{ borderColor: 'var(--border-color)' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                disabled={deleteModal.inputValue !== deleteModal.org.name}
                                className={`flex-1 py-3 rounded-xl font-bold text-white transition-all shadow-lg ${deleteModal.inputValue === deleteModal.org.name
                                    ? 'bg-gradient-to-r from-red-600 to-red-800 hover:shadow-red-900/40 transform hover:scale-[1.02]'
                                    : 'bg-gray-800 cursor-not-allowed opacity-50'
                                    }`}
                            >
                                Delete Forever
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
