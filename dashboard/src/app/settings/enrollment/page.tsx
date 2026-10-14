'use client'
import React, { useState, useEffect } from 'react'
import { Key, Plus, Copy, Check, Loader2, CheckCircle2, Pencil } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import NextArchiveBanner from '@/components/NextArchiveBanner'
import { getEnrollmentTokens, createEnrollmentToken, revokeEnrollmentToken, updateEnrollmentToken, EnrollmentToken, getOrgDetails } from '@/lib/api'
import { formatWATPattern } from '@/lib/time'
import { Panel, PanelHead, SectionHead, Eyebrow, ActionButton, StatusPill } from '@/components/ct/primitives'
import { useAuth } from '@/contexts/AuthContext'

export default function EnrollmentTokensPage() {
  const { user } = useAuth()
  const canMutate = user?.role === 'org_admin' || user?.role === 'super_admin'
  const [tokens, setTokens] = useState<EnrollmentToken[]>([])
  const [orgMaxAgents, setOrgMaxAgents] = useState<number>(100)
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  // New token state
  const [newToken, setNewToken] = useState({
    label: '',
    max_agents: 100,
    expires_at: ''
  })
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)

  // Edit-token state. editingToken holds the row being edited; null = modal closed.
  const [editingToken, setEditingToken] = useState<EnrollmentToken | null>(null)
  const [editForm, setEditForm] = useState({ label: '', max_agents: 1, expires_at: '' })

  useEffect(() => {
    // Default expiry to 24 hours from now
    const tmr = new Date()
    tmr.setDate(tmr.getDate() + 1)
    setNewToken(prev => ({ ...prev, expires_at: tmr.toISOString().split('T')[0] }))

    fetchData()
  }, [])

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const [tokensData, orgData] = await Promise.all([
        getEnrollmentTokens(),
        getOrgDetails()
      ])
      setTokens(tokensData)
      setOrgMaxAgents(orgData.max_agents)
      setNewToken(prev => ({ ...prev, max_agents: orgData.max_agents }))
    } catch (err) {
      console.error("Failed to load data:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      let finalExpiry: string | undefined = undefined;
      if (newToken.expires_at) {
        const selectedDate = new Date(newToken.expires_at);
        // Expire at the END of the chosen day, not the current time-of-day —
        // otherwise a token dated "today" expires within minutes of creation.
        selectedDate.setHours(23, 59, 59, 999);
        finalExpiry = selectedDate.toISOString();
      }

      const res = await createEnrollmentToken({
        label: newToken.label || undefined,
        max_agents: newToken.max_agents,
        expires_at: finalExpiry
      })

      setGeneratedToken(res.raw_token)
      setNewToken({ ...newToken, label: '', max_agents: 1 })
      fetchData()
    } catch (error: any) {
      console.error(error)
      alert(error?.response?.data?.message || 'Failed to generate token (Limit exceeded?)')
    }
  }

  const handleRevoke = async (tokenId: string) => {
    if (!confirm('Are you sure you want to revoke this token? Devices using it will immediately be rejected.')) return

    try {
      await revokeEnrollmentToken(tokenId)
      fetchData()
    } catch (error) {
      alert('Failed to revoke token')
    }
  }

  const openEdit = (token: EnrollmentToken) => {
    setEditForm({
      label: token.label || '',
      max_agents: token.max_agents || 1,
      expires_at: token.expires_at ? new Date(token.expires_at).toISOString().split('T')[0] : ''
    })
    setEditingToken(token)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingToken) return
    try {
      let finalExpiry: string | undefined = undefined
      if (editForm.expires_at) {
        const selectedDate = new Date(editForm.expires_at)
        // End of the chosen day (see handleCreate) — keeps a same-day expiry valid.
        selectedDate.setHours(23, 59, 59, 999)
        finalExpiry = selectedDate.toISOString()
      }
      await updateEnrollmentToken(editingToken.token_id, {
        label: editForm.label || undefined,
        max_agents: editForm.max_agents,
        expires_at: finalExpiry
      })
      setEditingToken(null)
      fetchData()
    } catch (error: any) {
      console.error(error)
      alert(error?.response?.data?.message || 'Failed to update token')
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedToken(text)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  // Slots committed against the org ceiling. An ACTIVE (non-revoked, non-expired) token reserves
  // its full max_agents allocation. An expired/revoked token no longer reserves unused slots, but
  // the agents actually enrolled under it are still running and still occupy capacity — so it keeps
  // counting its real agent_count. (Without this, an expired token would wrongly free the slot of
  // an agent that's still enrolled, e.g. showing "10 of 10" instead of "9 of 10".)
  const allocatedAgents = tokens.reduce((sum, t) => {
    const isActive = !t.revoked && (!t.expires_at || new Date(t.expires_at) > new Date())
    return sum + (isActive ? (t.max_agents || 0) : (t.agent_count || 0))
  }, 0)
  const remainingAgents = Math.max(0, orgMaxAgents - allocatedAgents)

  const inputBase = 'w-full px-4 py-3 rounded-sm border border-ct-line bg-ct-bg2 focus:border-ct-accent-border outline-none transition-colors text-[13px] text-ct-ink font-mono placeholder:text-ct-ink4'

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />
        <NextArchiveBanner />
        <main className="flex-1 overflow-auto p-8 mt-20 space-y-6">
          <SectionHead
            eyebrow="Fleet / Enrollment"
            title="Deployment Tokens"
            right={
              canMutate && (
                <ActionButton
                  onClick={() => { setNewToken(prev => ({ ...prev, max_agents: Math.max(1, remainingAgents) })); setIsModalOpen(true); setGeneratedToken(null); }}
                  variant="primary"
                >
                  <span className="inline-flex items-center gap-2">
                    <Plus className="w-3 h-3" />
                    Generate Token
                  </span>
                </ActionButton>
              )
            }
          />
          <p className="text-ct-ink3 text-[13px] -mt-2 max-w-3xl">
            Manage secure, short-lived tokens for deploying agents to your endpoints.
          </p>

          <Panel>
            <PanelHead
              title="Issued Tokens"
              meta={`${allocatedAgents} of ${orgMaxAgents} slots allocated · ${remainingAgents} free`}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-ct-bg2 border-b border-ct-line">
                  <tr>
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Label</th>
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Enrolled / Max</th>
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Expires At</th>
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Status</th>
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium text-right" style={{ letterSpacing: '0.18em' }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ct-line">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-ct-ink3" />
                        <p className="text-[12px] text-ct-ink3 font-mono uppercase" style={{ letterSpacing: '0.18em' }}>Loading tokens</p>
                      </td>
                    </tr>
                  ) : tokens.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <Key className="w-6 h-6 mx-auto mb-3 text-ct-ink4" />
                        <p className="text-[13px] text-ct-ink2 font-medium">No deployment tokens found.</p>
                        <p className="text-[11px] text-ct-ink3 mt-1">Generate a new token to start enrolling devices.</p>
                      </td>
                    </tr>
                  ) : tokens.map(token => {
                    const isExpired = token.expires_at && new Date(token.expires_at) < new Date();
                    const isRevoked = token.revoked;
                    const isInactive = isExpired || isRevoked;

                    return (
                      <tr key={token.token_id} className={`hover:bg-ct-bg2 transition-colors group ${isInactive ? 'opacity-60' : ''}`}>
                        <td className="px-6 py-4">
                          <div className="text-[13px] font-medium text-ct-ink">
                            {token.label || 'Unnamed Token'}
                          </div>
                          <div className="text-[10px] text-ct-ink3 font-mono mt-1" title={token.token_id}>
                            {token.token_id.split('-')[0]}…
                          </div>
                        </td>
                        <td className="px-6 py-4 text-[13px] text-ct-ink2 font-mono tabular-nums">
                          <span className="text-ct-ink font-medium">{token.agent_count}</span>
                          {' / '}
                          {token.max_agents ? `${token.max_agents}` : '∞'}
                        </td>
                        <td className={`px-6 py-4 text-[13px] font-mono tabular-nums ${isExpired ? 'text-ct-crit' : 'text-ct-ink2'}`}>
                          {token.expires_at ? formatWATPattern(token.expires_at, 'd MMM yyyy') : 'Never'}
                        </td>
                        <td className="px-6 py-4">
                          <StatusPill tone={isRevoked ? 'crit' : isExpired ? 'warn' : 'ok'}>
                            {isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                          </StatusPill>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            {/* Show actions on any NON-revoked token — incl. expired ones,
                                so a mis-dated token can be extended (Edit) or cleared (Revoke)
                                from the UI instead of needing SQL. Revoked rows stay action-less. */}
                            {!isRevoked && canMutate && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                                <ActionButton onClick={() => openEdit(token)} variant="ghost">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Pencil className="w-3 h-3" />
                                    Edit
                                  </span>
                                </ActionButton>
                                <ActionButton onClick={() => handleRevoke(token.token_id)} variant="danger">
                                  Revoke
                                </ActionButton>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </main>

        {/* Generate Token Modal */}
        {isModalOpen && !generatedToken && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ct-bg/85 backdrop-blur-sm">
            <Panel className="w-full max-w-md">
              <PanelHead title="Generate Deployment Token" meta="Enrollment key for new endpoints" />
              <form onSubmit={handleCreate} className="p-6 space-y-4">
                <div>
                  <Eyebrow className="mb-2">Label / Campaign Name</Eyebrow>
                  <input
                    type="text"
                    required
                    value={newToken.label}
                    onChange={(e) => setNewToken({ ...newToken, label: e.target.value })}
                    placeholder="e.g. Finance Dept Rollout"
                    className={inputBase}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Eyebrow className="mb-2">Max Enrollments</Eyebrow>
                    <input
                      type="number"
                      min="1"
                      max={remainingAgents}
                      value={newToken.max_agents}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val) && val >= 1 && val <= remainingAgents) {
                          setNewToken({ ...newToken, max_agents: val })
                        }
                      }}
                      className={inputBase}
                    />
                    <p className="text-[10px] mt-1.5 text-ct-ink3 font-mono" style={{ letterSpacing: '0.12em' }}>
                      {remainingAgents} OF {orgMaxAgents} REMAINING
                    </p>
                  </div>
                  <div>
                    <Eyebrow className="mb-2">Expiry Date</Eyebrow>
                    <input
                      type="date"
                      required
                      min={new Date().toISOString().split('T')[0]}
                      value={newToken.expires_at}
                      onChange={(e) => setNewToken({ ...newToken, expires_at: e.target.value })}
                      style={{ colorScheme: 'dark' }}
                      className={inputBase}
                    />
                  </div>
                </div>
                <div className="flex space-x-3 mt-6 pt-2">
                  <ActionButton onClick={() => setIsModalOpen(false)} variant="ghost" className="flex-1 py-3">
                    Cancel
                  </ActionButton>
                  <ActionButton type="submit" disabled={remainingAgents < 1} variant="primary" className="flex-1 py-3">
                    {remainingAgents < 1 ? 'No Slots Remaining' : 'Generate Secure Key'}
                  </ActionButton>
                </div>
              </form>
            </Panel>
          </div>
        )}

        {/* Edit Token Modal */}
        {editingToken && (() => {
          // The headroom available to THIS token = free org slots + the slots it
          // already holds (the backend excludes the token's own allocation too).
          const editMax = remainingAgents + (editingToken.max_agents || 0)
          return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ct-bg/85 backdrop-blur-sm">
              <Panel className="w-full max-w-md">
                <PanelHead title="Edit Deployment Token" meta={`${editingToken.agent_count} device(s) currently enrolled`} />
                <form onSubmit={handleUpdate} className="p-6 space-y-4">
                  <div>
                    <Eyebrow className="mb-2">Label / Campaign Name</Eyebrow>
                    <input
                      type="text"
                      required
                      value={editForm.label}
                      onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                      placeholder="e.g. Finance Dept Rollout"
                      className={inputBase}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Eyebrow className="mb-2">Max Enrollments</Eyebrow>
                      <input
                        type="number"
                        min="1"
                        max={editMax}
                        value={editForm.max_agents}
                        onChange={(e) => {
                          const val = parseInt(e.target.value)
                          if (!isNaN(val) && val >= 1 && val <= editMax) {
                            setEditForm({ ...editForm, max_agents: val })
                          }
                        }}
                        className={inputBase}
                      />
                      <p className="text-[10px] mt-1.5 text-ct-ink3 font-mono" style={{ letterSpacing: '0.12em' }}>
                        UP TO {editMax} OF {orgMaxAgents}
                      </p>
                    </div>
                    <div>
                      <Eyebrow className="mb-2">Expiry Date</Eyebrow>
                      <input
                        type="date"
                        required
                        min={new Date().toISOString().split('T')[0]}
                        value={editForm.expires_at}
                        onChange={(e) => setEditForm({ ...editForm, expires_at: e.target.value })}
                        style={{ colorScheme: 'dark' }}
                        className={inputBase}
                      />
                    </div>
                  </div>
                  <div className="flex space-x-3 mt-6 pt-2">
                    <ActionButton onClick={() => setEditingToken(null)} variant="ghost" className="flex-1 py-3">
                      Cancel
                    </ActionButton>
                    <ActionButton type="submit" variant="primary" className="flex-1 py-3">
                      Save Changes
                    </ActionButton>
                  </div>
                </form>
              </Panel>
            </div>
          )
        })()}

        {/* Display Generated Token Modal */}
        {isModalOpen && generatedToken && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-ct-bg/90 backdrop-blur-sm">
            <Panel className="w-full max-w-md" >
              <div className="border-b border-ct-line" style={{ background: 'var(--ct-ok-soft)' }}>
                <div className="px-6 py-4 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-ct-ok" />
                  <div>
                    <div className="text-[14px] font-semibold text-ct-ink" style={{ letterSpacing: '-0.005em' }}>Token Generated</div>
                    <Eyebrow className="mt-1 text-ct-crit">Never shown again</Eyebrow>
                  </div>
                </div>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <Eyebrow className="mb-2">Deployment Token</Eyebrow>
                  <div className="relative">
                    <div className="w-full px-4 py-4 rounded-sm border border-ct-line bg-ct-bg2 text-[12px] text-ct-ok font-mono break-all pr-12">
                      {generatedToken}
                    </div>
                    <button
                      onClick={() => copyToClipboard(generatedToken)}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 rounded-sm hover:bg-ct-panel-hi text-ct-ink3 hover:text-ct-ok transition-colors"
                      title="Copy Token"
                    >
                      {copiedToken === generatedToken ? <Check className="w-4 h-4 text-ct-ok" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <ActionButton onClick={() => setIsModalOpen(false)} variant="ghost" className="w-full py-3">
                  I have securely copied this token
                </ActionButton>
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  )
}
