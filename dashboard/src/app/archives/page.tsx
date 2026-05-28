'use client'

import React, { useEffect, useState } from 'react'
import { Archive, Download, Trash2, Calendar, Database, Shield, Lock, Search, AlertCircle, RefreshCw } from 'lucide-react'
import { getArchives, downloadArchive, deleteArchive, collateArchives, triggerManualArchive, Archive as ArchiveType } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import { useAuth } from '@/contexts/AuthContext'

export default function ArchivesPage() {
  const { user } = useAuth()
  const [archives, setArchives] = useState<ArchiveType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [password, setPassword] = useState('')
  const [selectedArchive, setSelectedArchive] = useState<ArchiveType | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCollating, setIsCollating] = useState(false)

  useEffect(() => {
    fetchArchives()
  }, [])

  const fetchArchives = async () => {
    setIsLoading(true)
    try {
      const data = await getArchives()
      setArchives(data)
    } catch (err) {
      console.error('Failed to fetch archives:', err)
      setError('Unable to load archives from vault.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!selectedArchive || !password) return
    setIsVerifying(true)
    setError(null)

    try {
      const blob = await downloadArchive(selectedArchive.id, password)
      
      // Create a URL and trigger download
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = selectedArchive.filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      
      // Post-download cleanup (Burn After Reading)
      setArchives(prev => prev.filter(a => a.id !== selectedArchive.id))
      setSelectedArchive(null)
      setPassword('')
      
    } catch (err: any) {
      setError(err.response?.status === 401 ? 'Incorrect administrator password.' : 'Verification failed. Archive access denied.')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleCollate = async () => {
    setIsCollating(true)
    setError(null)
    try {
      const res = await collateArchives()
      if (res.status === 'success') {
        fetchArchives()
      }
    } catch (err) {
      console.error('Collation failed:', err)
      setError('Bulk collation failed. Check network status.')
    } finally {
      setIsCollating(false)
    }
  }

  const filteredArchives = archives.filter(a => 
    a.agent_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.filename.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="flex h-screen bg-[#050510] text-slate-300">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />

        <main className="flex-1 overflow-y-auto p-8 lg:p-12 mt-20 ml-64">
          <div className="max-w-6xl mx-auto">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
              <div>
                <div className="flex items-center gap-3 mb-2 text-sky-400">
                  <Archive className="w-5 h-5" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Telemetry Records</span>
                </div>
                <h1 className="text-4xl font-extrabold text-white tracking-tight">Forensic Vault</h1>
                <p className="mt-3 text-slate-400 max-w-xl text-lg leading-relaxed">
                  Manage the automated weekly telemetry archives. All records adhere to the 
                  <span className="text-rose-400 font-medium ml-1">"Burn After Reading"</span> protocol.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <button 
                  onClick={fetchArchives}
                  className="p-2.5 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all text-slate-400"
                  title="Refresh Vault"
                >
                  <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button 
                  onClick={handleCollate}
                  disabled={isCollating}
                  className="px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-black font-bold text-sm transition-all shadow-lg shadow-sky-500/20 flex items-center gap-2 disabled:opacity-50"
                >
                  {isCollating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                  {isCollating ? 'Collating...' : 'Collate All Records'}
                </button>
                <div className="relative group">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-sky-400 transition-colors" />
                  <input
                    type="text"
                    placeholder="Search by Agent ID or Filename..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2.5 bg-white/[0.02] border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500/50 transition-all text-sm w-64 text-slate-200"
                  />
                </div>
              </div>
            </div>

            {/* Archive List */}
            <div className="bg-[#0C0E1C] border border-white/[0.06] rounded-3xl overflow-hidden shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.04] bg-white/[0.01]">
                      <th className="px-6 py-5 text-[10px] uppercase font-bold tracking-widest text-slate-500">Record Info</th>
                      <th className="px-6 py-5 text-[10px] uppercase font-bold tracking-widest text-slate-500">Telemetry Range</th>
                      <th className="px-6 py-5 text-[10px] uppercase font-bold tracking-widest text-slate-500">Volume</th>
                      <th className="px-6 py-5 text-[10px] uppercase font-bold tracking-widest text-slate-500">Lifecycle</th>
                      <th className="px-6 py-5 text-[10px] uppercase font-bold tracking-widest text-slate-500 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {isLoading ? (
                      Array(3).fill(0).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td colSpan={5} className="px-6 py-8 h-16 bg-white/[0.01]" />
                        </tr>
                      ))
                    ) : filteredArchives.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-20 text-center">
                          <div className="flex flex-col items-center gap-4">
                            <Database className="w-12 h-12 text-slate-800" />
                            <p className="text-slate-500 font-medium">No forensic archives found in vault.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredArchives.map((archive) => (
                        <tr key={archive.id} className="group hover:bg-white/[0.01] transition-all">
                          <td className="px-6 py-6">
                            <div>
                              <div className="text-sm font-bold text-slate-200 mb-1">{archive.agent_id}</div>
                              <div className="text-[10px] font-mono text-slate-500">{archive.filename}</div>
                            </div>
                          </td>
                          <td className="px-6 py-6 text-xs text-slate-400">
                            <div className="flex items-center gap-2 mb-1">
                              <Calendar className="w-3.5 h-3.5 text-slate-600" />
                              {new Date(archive.start_date).toLocaleDateString()}
                            </div>
                            <div className="text-[10px] text-slate-600">to {new Date(archive.end_date).toLocaleDateString()}</div>
                          </td>
                          <td className="px-6 py-6">
                            <div className="text-xs text-slate-300 font-medium">{formatSize(archive.size_bytes)}</div>
                            <div className="text-[10px] text-slate-500">{archive.event_count} telemetry packets</div>
                          </td>
                          <td className="px-6 py-6">
                            <div className="flex items-center gap-2 text-[10px] text-rose-400 font-bold uppercase tracking-widest">
                              <Shield className="w-3 h-3" />
                              Burn on Download
                            </div>
                          </td>
                          <td className="px-6 py-6 text-right">
                            <button
                              onClick={() => setSelectedArchive(archive)}
                              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500/10 hover:bg-sky-500 text-sky-400 hover:text-white border border-sky-500/20 rounded-xl transition-all font-bold text-xs"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Retrieve
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-8 flex items-center gap-3 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
              <AlertCircle className="w-5 h-5 text-slate-500 flex-shrink-0" />
              <p className="text-xs text-slate-500 leading-relaxed">
                Archives older than <span className="text-slate-300">3 days</span> are automatically purged from the vault to ensure maximum forensic privacy. 
                Please ensure you download and secure critical records immediately upon notification.
              </p>
            </div>
          </div>
        </main>
      </div>

      {/* Verification Modal */}
      {selectedArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[#050510]/80 backdrop-blur-sm">
          <div className="bg-[#0C0E1C] border border-white/10 p-8 rounded-3xl w-full max-w-md shadow-2xl relative animate-in fade-in zoom-in duration-300">
            <button 
              onClick={() => { setSelectedArchive(null); setPassword(''); setError(null); }}
              className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
            >
              ✕
            </button>

            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-sky-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 text-sky-400 border border-sky-500/20">
                <Lock className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Auth Required</h3>
              <p className="text-sm text-slate-400">
                You are accessing sensitive forensic telemetry for agent <span className="text-sky-400 font-medium">{(selectedArchive as any).agent_id}</span>. Please verify your administrative identity.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Admin Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-4 py-3 bg-white/[0.02] border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500/50 transition-all text-sm text-slate-200"
                />
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-medium animate-pulse">
                  {error}
                </div>
              )}

              <button
                onClick={handleDownload}
                disabled={isVerifying || !password}
                className="w-full py-4 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-bold text-sm shadow-lg shadow-sky-500/20 transition-all flex items-center justify-center gap-2"
              >
                {isVerifying ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Verify & Download
                  </>
                )}
              </button>
              
              <p className="text-[10px] text-center text-slate-600 px-4">
                Warning: This archive will be permanently destroyed after a successful download session.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
