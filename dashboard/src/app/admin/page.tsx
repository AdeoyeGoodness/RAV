'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus, ShieldCheck, Activity, Key, ChevronRight, Search, Loader2, UserPlus, ExternalLink, Mail, User as UserIcon, Copy, Check, Trash2, Undo2, AlertCircle, Pencil, Server } from 'lucide-react'
import { getOrganizations, createOrganization, updateOrganization, updateOrganizationStatus, deleteOrganization, restoreOrganizationData, register, Organization } from '@/lib/api'
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
    const [newOrg, setNewOrg] = useState({ name: '', admin_email: '', max_agents: 1000 })
    const [createdCredentials, setCreatedCredentials] = useState<{ orgName: string, email: string, password: string } | null>(null)

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
            const payload = {
                name: newOrg.name,
                admin_email: newOrg.admin_email,
                max_agents: newOrg.max_agents,
                token_expiry: null,
            }
            const res = await createOrganization(payload)
            setCreatedCredentials({
                orgName: res.organization.name,
                email: res.admin_email,
                password: res.temporary_password
            })
            setNewOrg({ name: '', admin_email: '', max_agents: 1000 })
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

    // Edit Max Agents Modal State
    const [editAgentsModal, setEditAgentsModal] = useState<{
        isOpen: boolean;
        org: Organization | null;
        value: number;
        submitting: boolean;
    }>({ isOpen: false, org: null, value: 0, submitting: false })

    const openEditMaxAgents = (org: Organization) => {
        setEditAgentsModal({ isOpen: true, org, value: org.max_agents, submitting: false })
    }

    const confirmEditMaxAgents = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editAgentsModal.org) return
        if (!Number.isFinite(editAgentsModal.value) || editAgentsModal.value < 1) {
            alert('Max agents must be a positive number.')
            return
        }
        setEditAgentsModal(s => ({ ...s, submitting: true }))
        try {
            await updateOrganization(editAgentsModal.org.id, { max_agents: editAgentsModal.value })
            setEditAgentsModal({ isOpen: false, org: null, value: 0, submitting: false })
            loadData()
        } catch (err: any) {
            console.error(err)
            alert(err?.response?.data?.message || 'Failed to update max agents.')
            setEditAgentsModal(s => ({ ...s, submitting: false }))
        }
    }

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

    // Removed token generation function since it's no longer needed in super admin view

    const filteredOrgs = organizations.filter(org =>
        org.name.toLowerCase().includes(searchQuery.toLowerCase())
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
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Created At</th>
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Max Agents</th>
                                            <th className="px-6 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/[0.04]">
                                        {loading ? (
                                            <tr>
                                                <td colSpan={5} className="px-6 py-12 text-center">
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
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-2 text-slate-300">
                                                        <Server className="w-3.5 h-3.5 text-slate-500" />
                                                        <span className="text-sm font-mono">{org.max_agents}</span>
                                                    </div>
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
                                                            onClick={() => openEditMaxAgents(org)}
                                                            className="p-1.5 rounded-lg border border-white/[0.06] hover:bg-violet-500/10 hover:border-violet-500/20 text-slate-400 hover:text-violet-400 transition-colors"
                                                            title="Edit Max Agents Limit"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => toggleStatus(org.id, org.status)}
                                                            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/[0.06] hover:bg-white/[0.03] text-slate-400 hover:text-slate-300 transition-colors"
                                                        >
                                                            {org.status === 'active' ? 'Pause' : 'Activate'}
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
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Org Admin Email</label>
                                <div className="relative flex items-center">
                                    <Mail className="absolute left-3 w-4 h-4 text-slate-500" />
                                    <input
                                        type="email"
                                        required
                                        value={newOrg.admin_email}
                                        onChange={(e) => setNewOrg({ ...newOrg, admin_email: e.target.value })}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                                        placeholder="admin@organization.com"
                                    />
                                </div>
                                <p className="text-[10px] mt-1.5 text-slate-600 font-medium">A temporary password will be securely generated.</p>
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Max Agents Limit</label>
                                <input
                                    type="number"
                                    required
                                    value={newOrg.max_agents}
                                    onChange={(e) => setNewOrg({ ...newOrg, max_agents: parseInt(e.target.value) || 0 })}
                                    className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                                    placeholder="1000"
                                    min="1"
                                />
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

            {/* Credentials Hand-off Modal */}
            {createdCredentials && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border bg-[#0C0E1C] border-emerald-500/30 p-8 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-emerald-800" />
                        
                        <div className="mb-6">
                            <h2 className="text-xl font-bold text-slate-200">Organization Created</h2>
                            <p className="text-xs mt-1 text-slate-400">Securely hand off these one-time credentials to the Organizational Admin of <span className="text-slate-300 font-semibold">{createdCredentials.orgName}</span>. They will be forced to rotate this password upon their first login.</p>
                        </div>
                        
                        <div className="space-y-4 mb-8">
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Admin Email</label>
                                <div className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] text-sm text-slate-300 font-mono">
                                    {createdCredentials.email}
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Temporary Password</label>
                                <div className="relative">
                                    <div className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] text-sm text-emerald-400 font-mono">
                                        {createdCredentials.password}
                                    </div>
                                    <button
                                        onClick={() => copyToClipboard(`URL: https://rav.local/login\nEmail: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`, 'creds')}
                                        className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-emerald-400 transition-colors"
                                        title="Copy All Credentials"
                                    >
                                        {copiedTokenIds.has('creds') ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => setCreatedCredentials(null)}
                            className="w-full py-3 rounded-xl font-semibold text-white bg-slate-800 hover:bg-slate-700 transition-colors border border-white/[0.06]"
                        >
                            I have securely copied these credentials
                        </button>
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

            {/* Edit Max Agents Modal */}
            {editAgentsModal.isOpen && editAgentsModal.org && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <form
                        onSubmit={confirmEditMaxAgents}
                        className="w-full max-w-md rounded-2xl border bg-[#0C0E1C] border-violet-500/30 p-8 shadow-2xl relative overflow-hidden"
                    >
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 to-violet-800" />

                        <div className="mb-6 flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
                                <Server className="w-5 h-5 text-violet-400" />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-slate-200">Update Max Agents</h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Adjust the agent quota for <strong className="text-slate-300">{editAgentsModal.org.name}</strong>.
                                </p>
                            </div>
                        </div>

                        <div className="mb-6 space-y-4">
                            <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/[0.04] bg-[#05050A]">
                                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Current Limit</span>
                                <span className="text-sm font-mono text-slate-300">{editAgentsModal.org.max_agents}</span>
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">New Max Agents</label>
                                <input
                                    type="number"
                                    required
                                    min={1}
                                    autoFocus
                                    value={Number.isFinite(editAgentsModal.value) ? editAgentsModal.value : ''}
                                    onChange={(e) => setEditAgentsModal(s => ({ ...s, value: parseInt(e.target.value) || 0 }))}
                                    className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-violet-500/50 outline-none transition-all text-sm text-slate-200 font-mono"
                                />
                                <p className="text-[10px] mt-1.5 text-slate-600">
                                    Existing enrollment tokens won't change — but the org admin can't issue new tokens above this cap.
                                </p>
                            </div>
                        </div>

                        <div className="flex space-x-3">
                            <button
                                type="button"
                                onClick={() => setEditAgentsModal({ isOpen: false, org: null, value: 0, submitting: false })}
                                className="flex-1 py-3 rounded-xl font-medium border border-white/[0.06] hover:bg-white/[0.02] text-slate-400 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={editAgentsModal.submitting || editAgentsModal.value === editAgentsModal.org.max_agents || editAgentsModal.value < 1}
                                className={`flex-1 py-3 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-2 ${
                                    editAgentsModal.submitting || editAgentsModal.value === editAgentsModal.org.max_agents || editAgentsModal.value < 1
                                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/[0.02]'
                                        : 'bg-violet-600 hover:bg-violet-500 shadow-[0_0_15px_rgba(139,92,246,0.3)] border border-violet-500/50'
                                }`}
                            >
                                {editAgentsModal.submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                Update Limit
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    )
}
