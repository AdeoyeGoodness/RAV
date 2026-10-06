'use client'

import React, { useEffect, useState } from 'react'
import { Archive, Download, Calendar, Database, Shield, Lock, Search, AlertCircle, RefreshCw, Package } from 'lucide-react'
import { getArchives, downloadArchive, downloadOrgBundle, deleteArchive, collateArchives, triggerManualArchive, getAgents, Agent, Archive as ArchiveType } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import NextArchiveBanner from '@/components/NextArchiveBanner'
import { useAuth } from '@/contexts/AuthContext'
import { formatWATDate } from '@/lib/time'
import { Panel, PanelHead, SectionHead, Eyebrow, ActionButton, StatusPill } from '@/components/ct/primitives'

export default function ArchivesPage() {
  const { user } = useAuth()
  const [archives, setArchives] = useState<ArchiveType[]>([])
  // Per-endpoint archive freshness, fetched alongside the archive rows so
  // operators can see which agents in the org still owe an archive vs
  // which are current. Reads agents.last_archived_at (stamped by the
  // archive service on every successful bundle).
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [password, setPassword] = useState('')
  const [selectedArchive, setSelectedArchive] = useState<ArchiveType | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCollating, setIsCollating] = useState(false)
  const [bundleOpen, setBundleOpen] = useState(false)
  const [bundlePassword, setBundlePassword] = useState('')
  const [isBundling, setIsBundling] = useState(false)
  const [bundleError, setBundleError] = useState<string | null>(null)

  useEffect(() => {
    fetchArchives()
  }, [])

  const fetchArchives = async () => {
    setIsLoading(true)
    try {
      const [archivesData, agentsData] = await Promise.all([
        getArchives(),
        getAgents().catch(() => [] as Agent[]),
      ])
      setArchives(archivesData)
      setAgents(agentsData)
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

  const handleBundleDownload = async () => {
    if (!bundlePassword) return
    setIsBundling(true)
    setBundleError(null)
    try {
      const { blob, filename } = await downloadOrgBundle(bundlePassword)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      // Bundle burns every archive it contained — wipe local state to match.
      setArchives([])
      setBundleOpen(false)
      setBundlePassword('')
    } catch (err: any) {
      if (err.response?.status === 401) {
        setBundleError('Incorrect administrator password.')
      } else if (err.response?.status === 404) {
        setBundleError('The vault is empty — nothing to bundle.')
      } else {
        setBundleError('Bundle download failed. Check network status.')
      }
    } finally {
      setIsBundling(false)
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

  const inputBase = 'w-full px-4 py-3 bg-ct-bg2 border border-ct-line rounded-sm focus:border-ct-accent-border outline-none transition-colors text-[13px] text-ct-ink font-mono placeholder:text-ct-ink4'

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
            eyebrow="Compliance / Vault"
            title="Forensic Vault"
            right={
              <div className="flex items-center gap-2">
                <ActionButton onClick={fetchArchives} variant="ghost">
                  <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                </ActionButton>
                <ActionButton onClick={handleCollate} disabled={isCollating} variant="primary">
                  <span className="inline-flex items-center gap-2">
                    {isCollating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
                    {isCollating ? 'Collating…' : 'Collate All Records'}
                  </span>
                </ActionButton>
                <ActionButton
                  onClick={() => { setBundleOpen(true); setBundleError(null); setBundlePassword('') }}
                  disabled={archives.length === 0}
                  variant="primary"
                >
                  <span className="inline-flex items-center gap-2">
                    <Package className="w-3 h-3" />
                    Download All (Bundle)
                  </span>
                </ActionButton>
              </div>
            }
          />
          <p className="text-ct-ink3 text-[13px] -mt-2 max-w-3xl">
            Automated telemetry archives across your fleet. Bundles rotate every
            5 days per endpoint and expire from the vault after 2 days. All
            records adhere to the <span className="text-ct-crit">Burn After Reading</span> protocol.
          </p>

          {/* Per-endpoint archive freshness ---------------------------------
              Not a per-archive view — a per-endpoint view answering "have I
              archived this device recently?" so an operator can spot
              endpoints whose bundle is overdue without cross-referencing the
              individual endpoint pages. Sorted worst-first. */}
          {(() => {
            const now = Date.now()
            const FIVE_DAYS_MS = 5 * 24 * 3600 * 1000
            const rows = [...agents].map((a) => {
              const t = a.last_archived_at_ms ?? null
              const ageMs = t ? Math.max(0, now - t) : Number.POSITIVE_INFINITY
              return { agent: a, ageMs }
            }).sort((a, b) => b.ageMs - a.ageMs)
            const overdue = rows.filter((r) => r.ageMs > FIVE_DAYS_MS).length
            const current = rows.length - overdue
            const shortLabel = (ms: number) => {
              if (!isFinite(ms)) return 'never'
              const h = Math.floor(ms / 3600000)
              const d = Math.floor(ms / 86400000)
              if (h < 1) return 'just now'
              if (h < 24) return `${h} h ago`
              if (d < 7) return `${d} d ago`
              return `${Math.floor(d / 7)} w ago`
            }
            const tone = (ms: number): 'ok' | 'warn' | 'crit' | 'idle' => {
              if (!isFinite(ms)) return 'idle'
              if (ms > FIVE_DAYS_MS + 2 * 24 * 3600 * 1000) return 'crit' // > 7 days
              if (ms > FIVE_DAYS_MS) return 'warn'
              return 'ok'
            }
            return (
              <Panel>
                <PanelHead
                  title="Endpoint archive freshness"
                  meta={
                    rows.length === 0
                      ? 'No endpoints enrolled'
                      : `${current} current · ${overdue} overdue · sorted oldest first`
                  }
                />
                {rows.length === 0 ? (
                  <div className="p-6 text-[12px] text-ct-ink3 font-mono">Awaiting enrollment.</div>
                ) : (
                  <div className="max-h-[280px] overflow-y-auto">
                    <ul className="divide-y divide-ct-line">
                      {rows.map(({ agent, ageMs }) => (
                        <li
                          key={agent.id}
                          className="grid items-center gap-3 px-5 py-2"
                          style={{ gridTemplateColumns: '1.5fr 90px 100px 100px' }}
                        >
                          <div className="min-w-0">
                            <a
                              href={`/devices/${agent.agent_id}`}
                              className="text-[13px] text-ct-ink font-medium truncate hover:text-ct-accent"
                            >
                              {agent.display_name || agent.hostname || agent.agent_id.slice(0, 20)}
                            </a>
                            <div
                              className="font-mono text-[10px] text-ct-ink3 truncate mt-0.5"
                              style={{ letterSpacing: '0.04em' }}
                            >
                              {agent.agent_id.slice(0, 24)}
                            </div>
                          </div>
                          {agent.campaign ? (
                            <StatusPill tone="accent" dot={false}>{agent.campaign}</StatusPill>
                          ) : (
                            <span className="text-[10px] text-ct-ink4 font-mono">—</span>
                          )}
                          <StatusPill tone={tone(ageMs)}>
                            {tone(ageMs) === 'idle' ? 'never archived' : tone(ageMs) === 'ok' ? 'current' : tone(ageMs) === 'warn' ? 'due' : 'overdue'}
                          </StatusPill>
                          <span
                            className="font-mono text-[11px] text-ct-ink3 text-right tabular-nums"
                            title={agent.last_archived_at || 'never'}
                          >
                            {shortLabel(ageMs)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            )
          })()}

          {/* Search bar */}
          <Panel>
            <div className="p-3 flex items-center gap-3 border-b border-ct-line bg-ct-bg2">
              <Search className="w-4 h-4 text-ct-ink3" />
              <input
                type="text"
                placeholder="Search by Agent ID or Filename…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none w-full text-[13px] text-ct-ink font-mono placeholder:text-ct-ink4"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-ct-line bg-ct-bg2">
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Record Info</th>
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Telemetry Range</th>
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Volume</th>
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium" style={{ letterSpacing: '0.18em' }}>Lifecycle</th>
                    <th className="px-6 py-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium text-right" style={{ letterSpacing: '0.18em' }}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ct-line">
                  {isLoading ? (
                    Array(3).fill(0).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={5} className="px-6 py-8 h-16 bg-ct-bg2 animate-pulse" />
                      </tr>
                    ))
                  ) : filteredArchives.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <Database className="w-8 h-8 text-ct-ink4" />
                          <p className="text-[13px] text-ct-ink3 font-medium">No forensic archives found in vault.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredArchives.map((archive) => (
                      <tr key={archive.id} className="hover:bg-ct-bg2 transition-colors">
                        <td className="px-6 py-4">
                          <div className="text-[13px] font-medium text-ct-ink mb-1">{archive.agent_id}</div>
                          <div className="text-[10px] font-mono text-ct-ink3">{archive.filename}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-[12px] text-ct-ink2 mb-1">
                            <Calendar className="w-3 h-3 text-ct-ink3" />
                            <span className="font-mono">{formatWATDate(archive.start_date)}</span>
                          </div>
                          <div className="text-[10px] text-ct-ink3 font-mono">to {formatWATDate(archive.end_date)}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-[13px] text-ct-ink font-mono tabular-nums">{formatSize(archive.size_bytes)}</div>
                          <div className="text-[10px] text-ct-ink3 font-mono tabular-nums">{archive.event_count} packets</div>
                        </td>
                        <td className="px-6 py-4">
                          <StatusPill tone="crit">
                            <Shield className="w-3 h-3" />
                            Burn on Download
                          </StatusPill>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <ActionButton onClick={() => setSelectedArchive(archive)} variant="primary">
                            <span className="inline-flex items-center gap-2">
                              <Download className="w-3 h-3" />
                              Retrieve
                            </span>
                          </ActionButton>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="flex items-center gap-3 p-4 rounded-sm bg-ct-panel border border-ct-line">
            <AlertCircle className="w-4 h-4 text-ct-ink3 flex-shrink-0" />
            <p className="text-[12px] text-ct-ink3">
              Archives older than <span className="text-ct-ink font-medium">2 days</span> are automatically purged from the vault to ensure maximum forensic privacy.
              Ensure you download and secure critical records immediately upon notification.
            </p>
          </div>
        </main>
      </div>

      {/* Bundle Download Modal */}
      {bundleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-ct-bg/85 backdrop-blur-sm">
          <Panel className="w-full max-w-md">
            <PanelHead
              title={
                <span className="flex items-center gap-2 text-ct-accent">
                  <Package className="w-4 h-4" />
                  Bundle &amp; Download
                </span>
              }
              right={
                <button
                  onClick={() => { setBundleOpen(false); setBundlePassword(''); setBundleError(null) }}
                  className="text-ct-ink3 hover:text-ct-ink transition-colors font-mono text-[13px]"
                >
                  ✕
                </button>
              }
            />
            <div className="p-6 space-y-5">
              <p className="text-[13px] text-ct-ink2">
                Every archive in the vault (<span className="text-ct-accent font-medium">{archives.length}</span>) will be packaged into a single ZIP — one folder per endpoint.
                All bundled archives are <span className="text-ct-crit font-medium">burned</span> after the download completes.
              </p>

              <div>
                <Eyebrow className="mb-2">Admin Password</Eyebrow>
                <input
                  type="password"
                  value={bundlePassword}
                  onChange={(e) => setBundlePassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && bundlePassword && !isBundling) handleBundleDownload() }}
                  placeholder="••••••••••••"
                  className={inputBase}
                  autoFocus
                />
              </div>

              {bundleError && (
                <div
                  className="p-3 rounded-sm border text-[12px] font-medium"
                  style={{ background: 'var(--ct-crit-soft)', borderColor: 'var(--ct-crit-border)', color: 'var(--ct-crit)' }}
                >
                  {bundleError}
                </div>
              )}

              <ActionButton
                onClick={handleBundleDownload}
                disabled={isBundling || !bundlePassword}
                variant="primary"
                className="w-full py-3"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {isBundling ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  {isBundling ? 'Bundling…' : 'Verify & Bundle'}
                </span>
              </ActionButton>

              <p className="text-[10px] text-center text-ct-ink3 px-4 font-mono uppercase" style={{ letterSpacing: '0.14em' }}>
                Every archive burned after successful download
              </p>
            </div>
          </Panel>
        </div>
      )}

      {/* Verification Modal */}
      {selectedArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-ct-bg/85 backdrop-blur-sm">
          <Panel className="w-full max-w-md">
            <PanelHead
              title={
                <span className="flex items-center gap-2 text-ct-accent">
                  <Lock className="w-4 h-4" />
                  Auth Required
                </span>
              }
              right={
                <button
                  onClick={() => { setSelectedArchive(null); setPassword(''); setError(null); }}
                  className="text-ct-ink3 hover:text-ct-ink transition-colors font-mono text-[13px]"
                >
                  ✕
                </button>
              }
            />
            <div className="p-6 space-y-5">
              <p className="text-[13px] text-ct-ink2">
                You are accessing sensitive forensic telemetry for agent{' '}
                <span className="text-ct-accent font-medium font-mono">{(selectedArchive as any).agent_id}</span>.
                Please verify your administrative identity.
              </p>

              <div>
                <Eyebrow className="mb-2">Admin Password</Eyebrow>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className={inputBase}
                />
              </div>

              {error && (
                <div
                  className="p-3 rounded-sm border text-[12px] font-medium"
                  style={{ background: 'var(--ct-crit-soft)', borderColor: 'var(--ct-crit-border)', color: 'var(--ct-crit)' }}
                >
                  {error}
                </div>
              )}

              <ActionButton
                onClick={handleDownload}
                disabled={isVerifying || !password}
                variant="primary"
                className="w-full py-3"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {isVerifying ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  {isVerifying ? 'Verifying…' : 'Verify & Download'}
                </span>
              </ActionButton>

              <p className="text-[10px] text-center text-ct-ink3 px-4 font-mono uppercase" style={{ letterSpacing: '0.14em' }}>
                Archive permanently destroyed after successful download
              </p>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
