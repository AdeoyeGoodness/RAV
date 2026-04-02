'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus, ShieldCheck, Activity, Key, ChevronRight, Search, Loader2, UserPlus, ExternalLink, Mail, User as UserIcon, Copy, Check, Trash2, Undo2 } from 'lucide-react'
import { getOrganizations, createOrganization, updateOrganizationStatus, deleteOrganization, restoreOrganizationData, register, Organization } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { useAuth } from '@/contexts/AuthContext'



export default function AdminPage() {
    const { user, isLoading } = useAuth()
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

    if (isLoading || !user || user.role !== 'super_admin') {
        return (
            <div className="min-h-screen bg-[#05050A] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-slate-700 border-t-slate-400 rounded-full animate-spin"></div>
                    <p className="text-xs text-slate-600 font-mono">Verifying access...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen bg-[#050510] text-slate-300 font-sans selection:bg-sky-500/20 overflow-hidden relative">
            <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[40%] bg-sky-900/10 blur-[180px] rounded-full pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-violet-900/8 blur-[180px] rounded-full pointer-events-none" />
            <Sidebar />
            <div className="flex-1 ml-64 relative z-10">
                <Header />
                <main className="pt-20 p-6 overflow-y-auto h-full scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
                    <div className="max-w-7xl mx-auto space-y-6">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h1 className="text-2xl font-bold mb-1 text-slate-200 tracking-tight">Organization Management</h1>
                                <p className="text-sm text-slate-500">Global oversight of all enterprise tenants and licenses</p>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="flex items-center px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 transition-all shadow-[0_0_20px_rgba(2,132,199,0.2)] hover:shadow-[0_0_25px_rgba(2,132,199,0.3)] border border-sky-500/50"
                            >
                                <Plus className="w-4 h-4 mr-2" />
                                New Organization
                            </button>
                        </div>

                        {/* Stats Overview */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
                            <div className="p-5 rounded-2xl bg-[#0C0E1C]/90 border border-white/[0.06] shadow-xl flex items-center space-x-4">
                                <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400">
                                    <Building2 className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Total Orgs</p>
                                    <p className="text-2xl font-bold text-slate-200">{organizations.length}</p>
                                </div>
                            </div>
                            <div className="p-5 rounded-2xl bg-[#0C0E1C]/90 border border-white/[0.06] shadow-xl flex items-center space-x-4">
                                <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400">
                                    <ShieldCheck className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Active Tokens</p>
                                    <p className="text-2xl font-bold text-slate-200">{organizations.filter(o => o.status === 'active').length}</p>
                                </div>
                            </div>
                            <div className="p-5 rounded-2xl bg-[#0C0E1C]/90 border border-white/[0.06] shadow-xl flex items-center space-x-4">
                                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                                    <Activity className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Platform Status</p>
                                    <p className="text-lg font-bold text-emerald-500">Operational</p>
                                </div>
                            </div>
                        </div>

                        {/* List */}
                        <div className="rounded-2xl border border-white/[0.06] overflow-hidden transition-all bg-[#0C0E1C]/90 shadow-xl">
                            <div className="p-4 flex items-center border-b border-white/[0.04]">
                                <Search className="w-4 h-4 mr-3 text-slate-500" />
                                <input
                                    type="text"
                                    placeholder="Filter by name or token..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="bg-transparent border-none outline-none w-full text-sm text-slate-200 placeholder:text-slate-600"
                                />
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-[#080A14]/40 border-b border-white/[0.04]">
                                        <tr>
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Organization Name</th>
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Quota</th>
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Expiry</th>
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Created At</th>
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/[0.04]">
                                        {loading ? (
                                            <tr>
                                                <td colSpan={6} className="px-6 py-12 text-center">
                                                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-500" />
                                                    <p className="text-xs text-slate-500">Loading organizations...</p>
                                                </td>
                                            </tr>
                                        ) : filteredOrgs.map(org => (
                                            <tr key={org.id} className="hover:bg-white/[0.02] transition-colors group">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center">
                                                        <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center mr-3 font-semibold text-xs text-sky-400">
                                                            {org.name.charAt(0)}
                                                        </div>
                                                        <span className="font-medium text-sm text-slate-200">{org.name}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-[11px] text-slate-400">
                                                    {org.max_agents} Agents
                                                </td>
                                                <td className={`px-6 py-4 text-[11px] font-mono ${org.token_expiry && new Date(org.token_expiry) < new Date() ? 'text-rose-400' : 'text-slate-400'}`}>
                                                    {org.token_expiry ? new Date(org.token_expiry).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never'}
                                                </td>
                                                <td className="px-6 py-4 text-[11px] font-mono text-slate-400">
                                                    {new Date(org.created_at_ms).toLocaleString('en-NG', {
                                                        timeZone: 'Africa/Lagos',
                                                        year: 'numeric',
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2.5 py-1 rounded-md text-[10px] uppercase font-bold ${org.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                                        {org.status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end space-x-1.5 opacity-50 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={() => { setSelectedOrg(org); setIsAdminModalOpen(true); }}
                                                            className="p-1.5 rounded-lg border border-white/[0.06] hover:bg-sky-500/10 hover:border-sky-500/20 text-slate-400 hover:text-sky-400 transition-colors"
                                                            title="Onboard Organization Admin"
                                                        >
                                                            <UserPlus className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => toggleStatus(org.id, org.status)}
                                                            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/[0.06] hover:bg-white/[0.03] text-slate-400 hover:text-slate-300 transition-colors"
                                                        >
                                                            {org.status === 'active' ? 'Pause' : 'Activate'}
                                                        </button>
                                                        <button
                                                            onClick={() => copyToClipboard(org.enrollment_token, org.id)}
                                                            className="p-1.5 rounded-lg border border-white/[0.06] hover:bg-white/[0.03] text-slate-400 hover:text-slate-300 transition-colors"
                                                            title="Copy Enrollment Token"
                                                        >
                                                            {copiedTokenIds.has(org.id) ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(org)}
                                                            className="p-1.5 rounded-lg border border-white/[0.06] hover:bg-rose-500/10 hover:border-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                                                            title="Delete Organization"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleRestore(org)}
                                                            className="p-1.5 rounded-lg border border-white/[0.06] hover:bg-emerald-500/10 hover:border-emerald-500/20 text-slate-400 hover:text-emerald-400 transition-colors"
                                                            title="Restore Deleted Data"
                                                        >
                                                            <Undo2 className="w-3.5 h-3.5" />
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
                    <div className="w-full max-w-md rounded-2xl border bg-[#0C0E1C] border-white/[0.06] p-8 shadow-2xl">
                        <h2 className="text-xl font-bold mb-6 text-slate-200">Register New Organization</h2>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Organization Name</label>
                                <input
                                    type="text"
                                    required
                                    value={newOrg.name}
                                    onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                                    className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Enrollment Token</label>
                                <div className="relative flex items-center">
                                    <Key className="absolute left-3 w-4 h-4 text-slate-500" />
                                    <input
                                        type="text"
                                        required
                                        value={newOrg.enrollment_token}
                                        onChange={(e) => setNewOrg({ ...newOrg, enrollment_token: e.target.value })}
                                        className="w-full pl-10 pr-12 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm font-mono text-slate-200"
                                    />
                                    <button
                                        type="button"
                                        onClick={generateToken}
                                        className="absolute right-3 p-1 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-sky-400 transition-colors"
                                        title="Regenerate Token"
                                    >
                                        <Activity className="w-4 h-4" />
                                    </button>
                                </div>
                                <p className="text-[10px] mt-1.5 text-slate-600">Auto-generated secure token for agent enrollment.</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Max Agents</label>
                                    <input
                                        type="number"
                                        value={newOrg.max_agents}
                                        onChange={(e) => setNewOrg({ ...newOrg, max_agents: parseInt(e.target.value) })}
                                        className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Expiry</label>
                                    <input
                                        type="date"
                                        required
                                        min={new Date().toISOString().split('T')[0]}
                                        value={newOrg.token_expiry}
                                        onChange={(e) => setNewOrg({ ...newOrg, token_expiry: e.target.value })}
                                        style={{ colorScheme: 'dark' }}
                                        className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                                    />
                                </div>
                            </div>
                            <div className="flex space-x-3 mt-8 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="flex-1 py-3 rounded-xl font-medium border border-white/[0.06] hover:bg-white/[0.02] text-slate-400 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-3 rounded-xl font-semibold text-white bg-sky-600 hover:bg-sky-500 transition-all shadow-[0_0_15px_rgba(2,132,199,0.3)] border border-sky-500/50"
                                >
                                    Create Organization
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Create Admin Modal */}
            {isAdminModalOpen && selectedOrg && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border bg-[#0C0E1C] border-white/[0.06] p-8 shadow-2xl">
                        <div className="mb-6">
                            <h2 className="text-xl font-bold text-slate-200">Onboard Tenant Admin</h2>
                            <p className="text-xs mt-1 text-slate-500">Set up the primary administrator for <span className="text-slate-300 font-semibold">{selectedOrg.name}</span></p>
                        </div>
                        <form onSubmit={handleCreateAdmin} className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Full Name</label>
                                <div className="relative">
                                    <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="text"
                                        required
                                        value={newAdmin.full_name}
                                        onChange={(e) => setNewAdmin({ ...newAdmin, full_name: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Email Address</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="email"
                                        required
                                        value={newAdmin.email}
                                        onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Initial Password</label>
                                <div className="relative">
                                    <Key className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="password"
                                        required
                                        value={newAdmin.password}
                                        onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                                    />
                                </div>
                            </div>
                            <div className="flex space-x-3 mt-8 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsAdminModalOpen(false)}
                                    className="flex-1 py-3 rounded-xl font-medium border border-white/[0.06] hover:bg-white/[0.02] text-slate-400 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="flex-1 py-3 rounded-xl font-semibold text-white bg-sky-600 hover:bg-sky-500 transition-all shadow-[0_0_15px_rgba(2,132,199,0.3)] border border-sky-500/50"
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
                    <div className="w-full max-w-md rounded-2xl border bg-[#0C0E1C] border-rose-500/30 p-8 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500 to-rose-800" />

                        <div className="mb-6 text-center">
                            <div className="w-14 h-14 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-4 border border-rose-500/20">
                                <Trash2 className="w-6 h-6 text-rose-500" />
                            </div>
                            <h2 className="text-lg font-bold text-slate-200 mb-2">Delete Organization?</h2>
                            <p className="text-xs text-slate-400">
                                This action is <span className="text-rose-400 font-semibold">irreversible</span>.
                                It will permanently destroy <strong className="text-slate-300">{deleteModal.org.name}</strong> and all associated agents, users, and events.
                            </p>
                        </div>

                        <div className="mb-6">
                            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500 text-center">
                                Type <span className="text-slate-300 select-all font-mono bg-white/[0.04] px-1 py-0.5 rounded mx-1">{deleteModal.org.name}</span> to confirm
                            </label>
                            <input
                                type="text"
                                value={deleteModal.inputValue}
                                onChange={(e) => setDeleteModal(prev => ({ ...prev, inputValue: e.target.value }))}
                                className={`w-full px-4 py-3 rounded-xl border bg-[#05050A] focus:outline-none transition-all text-sm font-mono text-center text-slate-200 ${deleteModal.inputValue === deleteModal.org.name ? 'border-rose-500/50' : 'border-white/[0.06]'}`}
                                placeholder={deleteModal.org.name}
                                autoFocus
                            />
                        </div>

                        <div className="flex space-x-3">
                            <button
                                onClick={() => setDeleteModal({ isOpen: false, org: null, inputValue: '' })}
                                className="flex-1 py-3 rounded-xl font-medium border border-white/[0.06] hover:bg-white/[0.02] text-slate-400 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                disabled={deleteModal.inputValue !== deleteModal.org.name}
                                className={`flex-1 py-3 rounded-xl font-semibold text-white transition-all ${deleteModal.inputValue === deleteModal.org.name
                                    ? 'bg-rose-600 hover:bg-rose-500 shadow-[0_0_15px_rgba(225,29,72,0.3)] border border-rose-500/50'
                                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/[0.02]'
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
