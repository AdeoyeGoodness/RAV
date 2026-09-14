'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus, ShieldCheck, Activity, Mail, Copy, Check, Trash2, Undo2, Pencil, Server, UserPlus, Search, Loader2, KeyRound, X, Eye, EyeOff } from 'lucide-react'
import { getOrganizations, createOrganization, updateOrganization, updateOrganizationStatus, deleteOrganization, restoreOrganizationData, register, Organization, getOrgAdmins, resetOrgAdminPassword, OrgAdminSummary } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { useAuth } from '@/contexts/AuthContext'
import { Panel, PanelHead, SectionHead, Eyebrow, ActionButton, StatusPill, Stat } from '@/components/ct/primitives'

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

    // Reset Org-Admin Password Modal State
    const [resetPwModal, setResetPwModal] = useState<{
        isOpen: boolean;
        org: Organization | null;
        admins: OrgAdminSummary[];
        loadingAdmins: boolean;
        selectedUserId: string | null;
        newPassword: string;
        confirmPassword: string;
        showPassword: boolean;
        submitting: boolean;
        justResetEmail: string | null;
    }>({
        isOpen: false, org: null, admins: [], loadingAdmins: false,
        selectedUserId: null, newPassword: '', confirmPassword: '',
        showPassword: false, submitting: false, justResetEmail: null,
    })

    const openResetPassword = async (org: Organization) => {
        setResetPwModal({
            isOpen: true, org, admins: [], loadingAdmins: true,
            selectedUserId: null, newPassword: '', confirmPassword: '',
            showPassword: false, submitting: false, justResetEmail: null,
        })
        try {
            const admins = await getOrgAdmins(org.id)
            setResetPwModal(s => ({
                ...s,
                admins,
                loadingAdmins: false,
                // Pre-select the sole admin when there's exactly one.
                selectedUserId: admins.length === 1 ? admins[0].id : null,
            }))
        } catch (err) {
            console.error(err)
            setResetPwModal(s => ({ ...s, loadingAdmins: false }))
            alert('Failed to load org admins for this organization.')
        }
    }

    const closeResetPassword = () => {
        setResetPwModal({
            isOpen: false, org: null, admins: [], loadingAdmins: false,
            selectedUserId: null, newPassword: '', confirmPassword: '',
            showPassword: false, submitting: false, justResetEmail: null,
        })
    }

    const submitResetPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!resetPwModal.org || !resetPwModal.selectedUserId) return
        if (resetPwModal.newPassword.length < 8) {
            alert('Password must be at least 8 characters.')
            return
        }
        if (resetPwModal.newPassword !== resetPwModal.confirmPassword) {
            alert('Passwords do not match.')
            return
        }
        setResetPwModal(s => ({ ...s, submitting: true }))
        try {
            const res = await resetOrgAdminPassword(
                resetPwModal.org.id,
                resetPwModal.selectedUserId,
                resetPwModal.newPassword,
            )
            setResetPwModal(s => ({
                ...s,
                submitting: false,
                justResetEmail: res.email,
                newPassword: '',
                confirmPassword: '',
                showPassword: false,
            }))
        } catch (err: any) {
            console.error(err)
            const msg = err?.response?.status === 400
                ? 'Password rejected (must be at least 8 chars).'
                : err?.response?.status === 404
                    ? 'That admin was not found under this organization.'
                    : 'Failed to reset password.'
            alert(msg)
            setResetPwModal(s => ({ ...s, submitting: false }))
        }
    }

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
        if (!confirm(`Restore deleted data for "${org.name}"?\n\nThis will recover all soft-deleted Agents, Events, and Files.`)) return

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

    const filteredOrgs = organizations.filter(org =>
        org.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (isLoading || !user || user.role !== 'super_admin') {
        return (
            <div className="min-h-screen bg-ct-bg flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 rounded-full animate-spin" style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }} />
                    <span className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.24em' }}>Verifying access</span>
                </div>
            </div>
        )
    }

    const inputBase = 'w-full px-4 py-3 rounded-sm border border-ct-line bg-ct-bg2 focus:border-ct-accent-border outline-none transition-colors text-[13px] text-ct-ink font-mono placeholder:text-ct-ink4'

    return (
        <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col overflow-hidden ml-64">
                <Header />
                <main className="flex-1 overflow-auto p-8 mt-20 space-y-6">
                    <SectionHead
                        eyebrow="Platform / Tenants"
                        title="Organization Management"
                        right={
                            <ActionButton onClick={() => setIsModalOpen(true)} variant="primary">
                                <span className="inline-flex items-center gap-2">
                                    <Plus className="w-3 h-3" />
                                    New Organization
                                </span>
                            </ActionButton>
                        }
                    />
                    <p className="text-ct-ink3 text-[13px] -mt-2 max-w-3xl">
                        Global oversight of all enterprise tenants and licenses.
                    </p>

                    {/* Stats */}
                    <Panel>
                        <div className="grid grid-cols-1 md:grid-cols-3">
                            <Stat
                                label="Total Orgs"
                                value={organizations.length}
                            />
                            <Stat
                                label="Active Tokens"
                                value={organizations.filter(o => o.status === 'active').length}
                                tone="accent"
                            />
                            <Stat
                                label="Platform Status"
                                value={<span className="text-[24px]">Operational</span>}
                                tone="ok"
                                last
                            />
                        </div>
                    </Panel>

                    {/* List */}
                    <Panel>
                        <div className="p-3 flex items-center gap-3 border-b border-ct-line bg-ct-bg2">
                            <Search className="w-4 h-4 text-ct-ink3" />
                            <input
                                type="text"
                                placeholder="Filter by name…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="bg-transparent border-none outline-none w-full text-[13px] text-ct-ink font-mono placeholder:text-ct-ink4"
                            />
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-ct-bg2 border-b border-ct-line">
                                    <tr>
                                        <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Organization</th>
                                        <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Created At</th>
                                        <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Status</th>
                                        <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Max Agents</th>
                                        <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium text-right" style={{ letterSpacing: '0.18em' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-ct-line">
                                    {loading ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-12 text-center">
                                                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-ct-ink3" />
                                                <p className="text-[11px] text-ct-ink3 font-mono uppercase" style={{ letterSpacing: '0.18em' }}>Loading organizations</p>
                                            </td>
                                        </tr>
                                    ) : filteredOrgs.map(org => (
                                        <tr key={org.id} className="hover:bg-ct-bg2 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center">
                                                    <div
                                                        className="w-7 h-7 rounded-sm flex items-center justify-center mr-3 font-mono text-[11px] text-ct-accent border border-ct-accent-border"
                                                        style={{ background: 'var(--ct-accent-soft)' }}
                                                    >
                                                        {org.name.charAt(0)}
                                                    </div>
                                                    <span className="font-medium text-[13px] text-ct-ink">{org.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-[11px] font-mono text-ct-ink3 tabular-nums">
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
                                                <StatusPill tone={org.status === 'active' ? 'ok' : 'crit'}>
                                                    {org.status}
                                                </StatusPill>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-ct-ink2">
                                                    <Server className="w-3 h-3 text-ct-ink3" />
                                                    <span className="text-[13px] font-mono tabular-nums">{org.max_agents}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => { setSelectedOrg(org); setIsAdminModalOpen(true); }}
                                                        className="p-1.5 rounded-sm border border-ct-line hover:border-ct-accent-border text-ct-ink3 hover:text-ct-accent transition-colors"
                                                        title="Onboard Organization Admin"
                                                    >
                                                        <UserPlus className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => openEditMaxAgents(org)}
                                                        className="p-1.5 rounded-sm border border-ct-line hover:border-ct-accent-border text-ct-ink3 hover:text-ct-accent transition-colors"
                                                        title="Edit Max Agents Limit"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => openResetPassword(org)}
                                                        className="p-1.5 rounded-sm border border-ct-line hover:border-ct-accent-border text-ct-ink3 hover:text-ct-accent transition-colors"
                                                        title="Reset Org Admin Password"
                                                    >
                                                        <KeyRound className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => toggleStatus(org.id, org.status)}
                                                        className="text-[11px] font-mono uppercase px-2.5 py-1 rounded-sm border border-ct-line hover:border-ct-line2 text-ct-ink3 hover:text-ct-ink2 transition-colors"
                                                        style={{ letterSpacing: '0.14em' }}
                                                    >
                                                        {org.status === 'active' ? 'Pause' : 'Activate'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(org)}
                                                        className="p-1.5 rounded-sm border border-ct-line hover:border-ct-crit-border text-ct-ink3 hover:text-ct-crit transition-colors"
                                                        title="Delete Organization"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleRestore(org)}
                                                        className="p-1.5 rounded-sm border border-ct-line hover:border-ct-ok-border text-ct-ink3 hover:text-ct-ok transition-colors"
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
                    </Panel>
                </main>
            </div>

            {/* Create Org Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ct-bg/85 backdrop-blur-sm">
                    <Panel className="w-full max-w-md">
                        <PanelHead title="Register New Organization" />
                        <form onSubmit={handleCreate} className="p-6 space-y-4">
                            <div>
                                <Eyebrow className="mb-2">Organization Name</Eyebrow>
                                <input
                                    type="text"
                                    required
                                    value={newOrg.name}
                                    onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                                    className={inputBase}
                                />
                            </div>
                            <div>
                                <Eyebrow className="mb-2">Org Admin Email</Eyebrow>
                                <div className="relative flex items-center">
                                    <Mail className="absolute left-3 w-4 h-4 text-ct-ink3" />
                                    <input
                                        type="email"
                                        required
                                        value={newOrg.admin_email}
                                        onChange={(e) => setNewOrg({ ...newOrg, admin_email: e.target.value })}
                                        className={inputBase + ' pl-10'}
                                        placeholder="admin@organization.com"
                                    />
                                </div>
                                <p className="text-[10px] mt-1.5 text-ct-ink3 font-mono" style={{ letterSpacing: '0.12em' }}>
                                    A TEMPORARY PASSWORD WILL BE GENERATED
                                </p>
                            </div>
                            <div>
                                <Eyebrow className="mb-2">Max Agents Limit</Eyebrow>
                                <input
                                    type="number"
                                    required
                                    value={newOrg.max_agents}
                                    onChange={(e) => setNewOrg({ ...newOrg, max_agents: parseInt(e.target.value) || 0 })}
                                    className={inputBase}
                                    placeholder="1000"
                                    min="1"
                                />
                            </div>
                            <div className="flex gap-3 mt-6 pt-2">
                                <ActionButton onClick={() => setIsModalOpen(false)} variant="ghost" className="flex-1 py-3">
                                    Cancel
                                </ActionButton>
                                <ActionButton type="submit" variant="primary" className="flex-1 py-3">
                                    Create Organization
                                </ActionButton>
                            </div>
                        </form>
                    </Panel>
                </div>
            )}

            {/* Credentials Hand-off Modal */}
            {createdCredentials && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-ct-bg/90 backdrop-blur-sm">
                    <Panel className="w-full max-w-md">
                        <div className="border-b border-ct-line" style={{ background: 'var(--ct-ok-soft)' }}>
                            <div className="px-6 py-4">
                                <div className="text-[14px] font-semibold text-ct-ink" style={{ letterSpacing: '-0.005em' }}>
                                    Organization Created
                                </div>
                                <Eyebrow className="mt-1">
                                    One-time credentials for {createdCredentials.orgName}
                                </Eyebrow>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <p className="text-[12px] text-ct-ink2">
                                Securely hand off these one-time credentials to the Organizational Admin. They will be forced to rotate this password upon their first login.
                            </p>

                            <div>
                                <Eyebrow className="mb-2">Admin Email</Eyebrow>
                                <div className="w-full px-4 py-3 rounded-sm border border-ct-line bg-ct-bg2 text-[12px] text-ct-ink font-mono">
                                    {createdCredentials.email}
                                </div>
                            </div>
                            <div>
                                <Eyebrow className="mb-2">Temporary Password</Eyebrow>
                                <div className="relative">
                                    <div className="w-full px-4 py-3 rounded-sm border border-ct-line bg-ct-bg2 text-[12px] text-ct-ok font-mono pr-12">
                                        {createdCredentials.password}
                                    </div>
                                    <button
                                        onClick={() => copyToClipboard(`URL: https://rav.local/login\nEmail: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`, 'creds')}
                                        className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 rounded-sm hover:bg-ct-panel-hi text-ct-ink3 hover:text-ct-ok transition-colors"
                                        title="Copy All Credentials"
                                    >
                                        {copiedTokenIds.has('creds') ? <Check className="w-4 h-4 text-ct-ok" /> : <Copy className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            <ActionButton onClick={() => setCreatedCredentials(null)} variant="ghost" className="w-full py-3">
                                I have securely copied these credentials
                            </ActionButton>
                        </div>
                    </Panel>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteModal.isOpen && deleteModal.org && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ct-bg/90 backdrop-blur-sm">
                    <Panel className="w-full max-w-md">
                        <div className="border-b border-ct-line" style={{ background: 'var(--ct-crit-soft)' }}>
                            <div className="px-6 py-4 flex items-center gap-3">
                                <Trash2 className="w-4 h-4 text-ct-crit" />
                                <div>
                                    <div className="text-[14px] font-semibold text-ct-ink" style={{ letterSpacing: '-0.005em' }}>
                                        Delete Organization?
                                    </div>
                                    <Eyebrow className="mt-1 text-ct-crit">Irreversible</Eyebrow>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 space-y-5">
                            <p className="text-[13px] text-ct-ink2 text-center">
                                This will permanently destroy <strong className="text-ct-ink">{deleteModal.org.name}</strong> and all associated agents, users, and events.
                            </p>

                            <div>
                                <Eyebrow className="mb-2 text-center">
                                    Type <span className="text-ct-ink font-mono">{deleteModal.org.name}</span> to confirm
                                </Eyebrow>
                                <input
                                    type="text"
                                    value={deleteModal.inputValue}
                                    onChange={(e) => setDeleteModal(prev => ({ ...prev, inputValue: e.target.value }))}
                                    className={inputBase + ' text-center'}
                                    placeholder={deleteModal.org.name}
                                    autoFocus
                                    style={{
                                        borderColor: deleteModal.inputValue === deleteModal.org.name ? 'var(--ct-crit-border)' : undefined,
                                    }}
                                />
                            </div>

                            <div className="flex gap-3">
                                <ActionButton onClick={() => setDeleteModal({ isOpen: false, org: null, inputValue: '' })} variant="ghost" className="flex-1 py-3">
                                    Cancel
                                </ActionButton>
                                <ActionButton
                                    onClick={confirmDelete}
                                    disabled={deleteModal.inputValue !== deleteModal.org.name}
                                    variant="danger"
                                    className="flex-1 py-3"
                                >
                                    Delete Forever
                                </ActionButton>
                            </div>
                        </div>
                    </Panel>
                </div>
            )}

            {/* Edit Max Agents Modal */}
            {editAgentsModal.isOpen && editAgentsModal.org && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ct-bg/90 backdrop-blur-sm">
                    <Panel className="w-full max-w-md">
                        <form onSubmit={confirmEditMaxAgents}>
                            <PanelHead
                                title={
                                    <span className="flex items-center gap-2">
                                        <Server className="w-4 h-4 text-ct-accent" />
                                        Update Max Agents
                                    </span>
                                }
                                meta={`Adjust the agent quota for ${editAgentsModal.org.name}`}
                            />
                            <div className="p-6 space-y-4">
                                <div className="flex items-center justify-between px-4 py-3 rounded-sm border border-ct-line bg-ct-bg2">
                                    <Eyebrow>Current Limit</Eyebrow>
                                    <span className="text-[13px] font-mono text-ct-ink tabular-nums">{editAgentsModal.org.max_agents}</span>
                                </div>
                                <div>
                                    <Eyebrow className="mb-2">New Max Agents</Eyebrow>
                                    <input
                                        type="number"
                                        required
                                        min={1}
                                        autoFocus
                                        value={Number.isFinite(editAgentsModal.value) ? editAgentsModal.value : ''}
                                        onChange={(e) => setEditAgentsModal(s => ({ ...s, value: parseInt(e.target.value) || 0 }))}
                                        className={inputBase}
                                    />
                                    <p className="text-[10px] mt-1.5 text-ct-ink3">
                                        Existing enrollment tokens won&apos;t change — the org admin can&apos;t issue new tokens above this cap.
                                    </p>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <ActionButton
                                        onClick={() => setEditAgentsModal({ isOpen: false, org: null, value: 0, submitting: false })}
                                        variant="ghost"
                                        className="flex-1 py-3"
                                    >
                                        Cancel
                                    </ActionButton>
                                    <ActionButton
                                        type="submit"
                                        disabled={editAgentsModal.submitting || editAgentsModal.value === editAgentsModal.org.max_agents || editAgentsModal.value < 1}
                                        variant="primary"
                                        className="flex-1 py-3"
                                    >
                                        {editAgentsModal.submitting ? (
                                            <span className="inline-flex items-center gap-2">
                                                <Loader2 className="w-3 h-3 animate-spin" /> Updating…
                                            </span>
                                        ) : 'Update Limit'}
                                    </ActionButton>
                                </div>
                            </div>
                        </form>
                    </Panel>
                </div>
            )}

            {/* Reset Org-Admin Password Modal */}
            {resetPwModal.isOpen && resetPwModal.org && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ct-bg/90 backdrop-blur-sm">
                    <Panel className="w-full max-w-md">
                        <PanelHead
                            title={
                                <span className="flex items-center gap-2">
                                    <KeyRound className="w-4 h-4 text-ct-accent" />
                                    Reset Org Admin Password
                                </span>
                            }
                            meta={`For ${resetPwModal.org.name}`}
                        />
                        {resetPwModal.justResetEmail ? (
                            // Success state
                            <div className="p-6 space-y-4">
                                <div className="rounded-sm border border-ct-ok-border bg-ct-ok-soft p-4">
                                    <div className="flex items-start gap-3">
                                        <Check className="w-4 h-4 text-ct-ok mt-0.5 flex-shrink-0" />
                                        <div className="min-w-0">
                                            <div className="text-[13px] text-ct-ink font-medium">Password reset</div>
                                            <div className="text-[11px] text-ct-ink2 mt-1 break-all">
                                                <span className="font-mono">{resetPwModal.justResetEmail}</span> can now sign in with the new password.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-[11px] text-ct-ink3">
                                    Existing sessions (JWT tokens) stay valid until they expire — if you need instant cutover, ask them to click Sign out.
                                </p>
                                <div className="flex gap-3 pt-2">
                                    <ActionButton onClick={closeResetPassword} variant="primary" className="flex-1 py-3">Done</ActionButton>
                                </div>
                            </div>
                        ) : resetPwModal.loadingAdmins ? (
                            <div className="p-8 flex items-center justify-center">
                                <Loader2 className="w-5 h-5 animate-spin text-ct-ink3" />
                            </div>
                        ) : resetPwModal.admins.length === 0 ? (
                            <div className="p-6 space-y-4">
                                <p className="text-[13px] text-ct-ink2">This organization has no org_admin accounts. Use the Onboard Admin action to create one first.</p>
                                <ActionButton onClick={closeResetPassword} variant="ghost" className="w-full py-3">Close</ActionButton>
                            </div>
                        ) : (
                            <form onSubmit={submitResetPassword} className="p-6 space-y-4">
                                <div>
                                    <Eyebrow className="mb-2">Which admin</Eyebrow>
                                    <div className="space-y-1.5">
                                        {resetPwModal.admins.map(a => (
                                            <label
                                                key={a.id}
                                                className={`flex items-center gap-3 px-3 py-2.5 rounded-sm border cursor-pointer transition-colors ${
                                                    resetPwModal.selectedUserId === a.id
                                                        ? 'border-ct-accent-border bg-ct-accent-soft'
                                                        : 'border-ct-line bg-ct-bg2 hover:border-ct-line2'
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="reset-admin-target"
                                                    checked={resetPwModal.selectedUserId === a.id}
                                                    onChange={() => setResetPwModal(s => ({ ...s, selectedUserId: a.id }))}
                                                    className="accent-ct-accent"
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[13px] font-mono text-ct-ink truncate">{a.email}</div>
                                                    {a.full_name && (
                                                        <div className="text-[11px] text-ct-ink3 truncate">{a.full_name}</div>
                                                    )}
                                                </div>
                                                {a.status !== 'active' && (
                                                    <StatusPill tone="idle">{a.status}</StatusPill>
                                                )}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <Eyebrow className="mb-2">New password (min 8)</Eyebrow>
                                    <div className="relative flex items-center">
                                        <input
                                            type={resetPwModal.showPassword ? 'text' : 'password'}
                                            required
                                            minLength={8}
                                            value={resetPwModal.newPassword}
                                            onChange={(e) => setResetPwModal(s => ({ ...s, newPassword: e.target.value }))}
                                            className={inputBase + ' pr-10'}
                                            autoComplete="new-password"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setResetPwModal(s => ({ ...s, showPassword: !s.showPassword }))}
                                            className="absolute right-3 text-ct-ink3 hover:text-ct-ink"
                                            title={resetPwModal.showPassword ? 'Hide' : 'Show'}
                                        >
                                            {resetPwModal.showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <Eyebrow className="mb-2">Confirm password</Eyebrow>
                                    <input
                                        type={resetPwModal.showPassword ? 'text' : 'password'}
                                        required
                                        minLength={8}
                                        value={resetPwModal.confirmPassword}
                                        onChange={(e) => setResetPwModal(s => ({ ...s, confirmPassword: e.target.value }))}
                                        className={inputBase}
                                        autoComplete="new-password"
                                    />
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <ActionButton onClick={closeResetPassword} variant="ghost" className="flex-1 py-3">Cancel</ActionButton>
                                    <ActionButton
                                        type="submit"
                                        variant="primary"
                                        className="flex-1 py-3"
                                        disabled={
                                            resetPwModal.submitting ||
                                            !resetPwModal.selectedUserId ||
                                            resetPwModal.newPassword.length < 8 ||
                                            resetPwModal.newPassword !== resetPwModal.confirmPassword
                                        }
                                    >
                                        {resetPwModal.submitting ? (
                                            <span className="inline-flex items-center gap-2">
                                                <Loader2 className="w-3 h-3 animate-spin" /> Resetting…
                                            </span>
                                        ) : 'Reset password'}
                                    </ActionButton>
                                </div>
                            </form>
                        )}
                    </Panel>
                </div>
            )}

            {/* Onboard Admin Modal */}
            {isAdminModalOpen && selectedOrg && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ct-bg/85 backdrop-blur-sm">
                    <Panel className="w-full max-w-md">
                        <PanelHead
                            title={
                                <span className="flex items-center gap-2">
                                    <UserPlus className="w-4 h-4 text-ct-accent" />
                                    Onboard Admin
                                </span>
                            }
                            meta={`For ${selectedOrg.name}`}
                        />
                        <form onSubmit={handleCreateAdmin} className="p-6 space-y-4">
                            <div>
                                <Eyebrow className="mb-2">Full Name</Eyebrow>
                                <input
                                    type="text"
                                    required
                                    value={newAdmin.full_name}
                                    onChange={(e) => setNewAdmin({ ...newAdmin, full_name: e.target.value })}
                                    className={inputBase}
                                />
                            </div>
                            <div>
                                <Eyebrow className="mb-2">Email</Eyebrow>
                                <input
                                    type="email"
                                    required
                                    value={newAdmin.email}
                                    onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })}
                                    className={inputBase}
                                />
                            </div>
                            <div>
                                <Eyebrow className="mb-2">Password</Eyebrow>
                                <input
                                    type="password"
                                    required
                                    value={newAdmin.password}
                                    onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })}
                                    className={inputBase}
                                />
                            </div>
                            <div className="flex gap-3 mt-6 pt-2">
                                <ActionButton onClick={() => setIsAdminModalOpen(false)} variant="ghost" className="flex-1 py-3">
                                    Cancel
                                </ActionButton>
                                <ActionButton type="submit" variant="primary" className="flex-1 py-3">
                                    Create Admin
                                </ActionButton>
                            </div>
                        </form>
                    </Panel>
                </div>
            )}
        </div>
    )
}
