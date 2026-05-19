'use client'
import React, { useState, useEffect } from 'react'
import { Key, Plus, Copy, Check, Trash2, Loader2, ShieldCheck, CheckCircle2 } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { getEnrollmentTokens, createEnrollmentToken, revokeEnrollmentToken, EnrollmentToken, getOrgDetails, Organization } from '@/lib/api'

export default function EnrollmentTokensPage() {
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
          const now = new Date();
          const selectedDate = new Date(newToken.expires_at);
          selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
          finalExpiry = selectedDate.toISOString();
      }

      const res = await createEnrollmentToken({
        label: newToken.label || undefined,
        max_agents: newToken.max_agents,
        expires_at: finalExpiry
      })
      
      setGeneratedToken(res.raw_token)
      setNewToken({ ...newToken, label: '', max_agents: orgMaxAgents })
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedToken(text)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  return (
    <div className="flex h-screen bg-[#050510] text-slate-300 font-sans selection:bg-sky-500/20 overflow-hidden relative">
      <div className="absolute top-[-20%] left-[-10%] w-[40%] h-[40%] bg-sky-900/10 blur-[180px] rounded-full pointer-events-none" />
      <Sidebar />
      <div className="flex-1 ml-64 relative z-10 flex flex-col">
        <Header />
        <main className="pt-24 p-8 overflow-y-auto h-full scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
          <div className="max-w-5xl mx-auto space-y-6">
            <header className="flex justify-between items-center mb-10">
              <div className="flex items-center gap-4">
                <div className="bg-sky-500/10 p-3 rounded-2xl">
                  <Key className="w-8 h-8 text-sky-400" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white tracking-tight">Deployment Tokens</h1>
                  <p className="text-slate-500 text-sm mt-1">Manage secure, short-lived tokens for deploying agents to your endpoints.</p>
                </div>
              </div>
              <button
                  onClick={() => { setIsModalOpen(true); setGeneratedToken(null); }}
                  className="flex items-center px-5 py-3 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 transition-all shadow-[0_0_20px_rgba(2,132,199,0.2)] hover:shadow-[0_0_25px_rgba(2,132,199,0.3)] border border-sky-500/50"
              >
                  <Plus className="w-4 h-4 mr-2" />
                  Generate Token
              </button>
            </header>

            <div className="rounded-2xl border border-white/[0.06] overflow-hidden transition-all bg-[#0C0E1C]/90 shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#080A14]/40 border-b border-white/[0.04]">
                    <tr>
                      <th className="px-6 py-4 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Label</th>
                      <th className="px-6 py-4 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Max Uses</th>
                      <th className="px-6 py-4 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Expires At</th>
                      <th className="px-6 py-4 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-4 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {isLoading ? (
                        <tr>
                            <td colSpan={5} className="px-6 py-12 text-center">
                                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-500" />
                                <p className="text-xs text-slate-500">Loading tokens...</p>
                            </td>
                        </tr>
                    ) : tokens.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="px-6 py-12 text-center">
                                <Key className="w-8 h-8 mx-auto mb-3 text-slate-600 opacity-50" />
                                <p className="text-sm text-slate-400 font-medium">No deployment tokens found.</p>
                                <p className="text-xs text-slate-500 mt-1">Generate a new token to start enrolling devices.</p>
                            </td>
                        </tr>
                    ) : tokens.map(token => {
                      const isExpired = token.expires_at && new Date(token.expires_at) < new Date();
                      const isRevoked = token.revoked;
                      const isInactive = isExpired || isRevoked;

                      return (
                        <tr key={token.token_id} className={`hover:bg-white/[0.02] transition-colors group ${isInactive ? 'opacity-60 grayscale-[0.3]' : ''}`}>
                          <td className="px-6 py-5">
                            <div className="flex items-center">
                                <span className={`font-medium text-sm ${isInactive ? 'text-slate-400' : 'text-slate-200'}`}>
                                  {token.label || 'Unnamed Token'}
                                </span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono mt-1" title={token.token_id}>
                              {token.token_id.split('-')[0]}...
                            </div>
                          </td>
                          <td className="px-6 py-5 text-sm text-slate-400">
                              {token.max_agents ? `${token.max_agents}` : 'Unlimited'}
                          </td>
                          <td className={`px-6 py-5 text-sm font-mono ${isExpired ? 'text-rose-400' : 'text-slate-400'}`}>
                              {token.expires_at ? new Date(token.expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never'}
                          </td>
                          <td className="px-6 py-5">
                            <span className={`px-2.5 py-1 rounded-md text-[10px] uppercase font-bold ${
                              isRevoked ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' 
                              : isExpired ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                                {isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                              <div className="flex items-center justify-end space-x-2">
                                  {!isInactive && (
                                    <button
                                        onClick={() => handleRevoke(token.token_id)}
                                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                        Revoke
                                    </button>
                                  )}
                              </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>

        {/* Generate Token Modal */}
        {isModalOpen && !generatedToken && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="w-full max-w-md rounded-2xl border bg-[#0C0E1C] border-white/[0.06] p-8 shadow-2xl">
                    <h2 className="text-xl font-bold mb-2 text-slate-200">Generate Deployment Token</h2>
                    <p className="text-xs text-slate-500 mb-6">Create a secure enrollment key for new endpoints.</p>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Label / Campaign Name</label>
                            <input
                                type="text"
                                required
                                value={newToken.label}
                                onChange={(e) => setNewToken({ ...newToken, label: e.target.value })}
                                placeholder="e.g. Finance Dept Rollout"
                                className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">
                                    Max Enrollments (Limit: {orgMaxAgents})
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    max={orgMaxAgents}
                                    value={newToken.max_agents}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        if (val <= orgMaxAgents) {
                                            setNewToken({ ...newToken, max_agents: val })
                                        }
                                    }}
                                    className="w-full px-4 py-3 rounded-xl border border-white/[0.06] bg-[#05050A] focus:border-sky-500/50 outline-none transition-all text-sm text-slate-200"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Expiry Date</label>
                                <input
                                    type="date"
                                    required
                                    min={new Date().toISOString().split('T')[0]}
                                    value={newToken.expires_at}
                                    onChange={(e) => setNewToken({ ...newToken, expires_at: e.target.value })}
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
                                Generate Secure Key
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        )}

        {/* Display Generated Token Modal */}
        {isModalOpen && generatedToken && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <div className="w-full max-w-md rounded-2xl border bg-[#0C0E1C] border-emerald-500/30 p-8 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-emerald-800" />
                    
                    <div className="mb-6 flex items-center gap-3">
                        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                        <div>
                          <h2 className="text-xl font-bold text-slate-200">Token Generated</h2>
                          <p className="text-xs mt-1 text-slate-400">This raw token will <strong className="text-rose-400">never be shown again</strong>.</p>
                        </div>
                    </div>
                    
                    <div className="mb-8">
                        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2 text-slate-500">Deployment Token</label>
                        <div className="relative">
                            <div className="w-full px-4 py-4 rounded-xl border border-white/[0.06] bg-[#05050A] text-sm text-emerald-400 font-mono break-all pr-12">
                                {generatedToken}
                            </div>
                            <button
                                onClick={() => copyToClipboard(generatedToken)}
                                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-emerald-400 transition-colors"
                                title="Copy Token"
                            >
                                {copiedToken === generatedToken ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsModalOpen(false)}
                        className="w-full py-3 rounded-xl font-semibold text-white bg-slate-800 hover:bg-slate-700 transition-colors border border-white/[0.06]"
                    >
                        I have securely copied this token
                    </button>
                </div>
            </div>
        )}
      </div>
    </div>
  )
}
