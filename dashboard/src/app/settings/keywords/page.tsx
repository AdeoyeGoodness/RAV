'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Globe, Building2, RefreshCw, AlertCircle, Regex } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import { formatWATDate } from '@/lib/time'
import { Panel, PanelHead, Eyebrow, SectionHead, StatusPill, ActionButton } from '@/components/ct/primitives'
import { useAuth } from '@/contexts/AuthContext'

interface Keyword {
  id: string
  organization_id: string | null
  keyword: string
  is_regex: boolean
  is_global: boolean
  created_at: string
}

export default function KeywordsSettings() {
  const { user } = useAuth()
  const canMutate = user?.role === 'org_admin' || user?.role === 'super_admin'
  const [rows, setRows] = useState<Keyword[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newKeyword, setNewKeyword] = useState('')
  const [newIsRegex, setNewIsRegex] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/org/keywords`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      setRows(await res.json())
    } catch {
      setError('Unable to load keyword list.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    const kw = newKeyword.trim()
    if (!kw) return
    setAdding(true)
    setError(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/org/keywords`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw, is_regex: newIsRegex }),
      })
      if (res.status === 400) {
        setError(newIsRegex ? 'Invalid regular expression.' : 'Keyword rejected (empty or too long).')
        return
      }
      if (!res.ok) throw new Error(`status ${res.status}`)
      const inserted: Keyword = await res.json()
      setRows((prev) => {
        const others = prev.filter((r) => !(r.keyword === inserted.keyword && !r.is_global))
        return [...others, inserted].sort((a, b) => {
          if (a.is_global !== b.is_global) return a.is_global ? -1 : 1
          return a.keyword.localeCompare(b.keyword)
        })
      })
      setNewKeyword('')
      setNewIsRegex(false)
    } catch {
      setError('Failed to add keyword.')
    } finally {
      setAdding(false)
    }
  }

  const remove = async (id: string) => {
    const before = rows
    setRows((prev) => prev.filter((r) => r.id !== id))
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/org/keywords/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
    } catch {
      setError('Failed to delete keyword.')
      setRows(before)
    }
  }

  const globals = rows.filter((r) => r.is_global)
  const org = rows.filter((r) => !r.is_global)

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />

        <main className="flex-1 overflow-y-auto p-8 mt-20 space-y-6">
          <SectionHead
            eyebrow="Tesseract OCR · every screenshot · retroactively scanned on rule change"
            title="Sensitive keyword scanning"
            right={
              <div className="flex items-center gap-2">
                <StatusPill tone="accent" dot={false}>{globals.length} platform</StatusPill>
                <StatusPill tone="ok" dot={false}>{org.length} organization</StatusPill>
              </div>
            }
          />

          {/* Add form — only visible to org_admins. Analysts (role='user')
              can browse the roster but cannot mutate it; server-side gate
              in api::org::create_keyword enforces this even if the form
              were somehow reached. */}
          {canMutate && (
          <Panel>
            <PanelHead title="Add rule" meta="Applies to future captures + triggers retroactive rescan of all existing files" />
            <div className="p-5">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[260px]">
                  <Eyebrow className="mb-2">New keyword or regex</Eyebrow>
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !adding) add()
                    }}
                    placeholder={newIsRegex ? 'e.g. \\b\\d{16}\\b' : 'e.g. Confidential'}
                    className="w-full px-3 py-[9px] text-[13px] font-mono text-ct-ink placeholder:text-ct-ink3 focus:outline-none rounded-sm"
                    style={{
                      background: 'var(--ct-bg2)',
                      border: '1px solid var(--ct-line2)',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--ct-accent-border)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--ct-line2)')}
                  />
                </div>
                <label className="flex items-center gap-2 text-[11px] font-mono uppercase text-ct-ink2 cursor-pointer select-none pb-[9px]"
                  style={{ letterSpacing: '0.16em' }}>
                  <input
                    type="checkbox"
                    checked={newIsRegex}
                    onChange={(e) => setNewIsRegex(e.target.checked)}
                    className="w-4 h-4"
                    style={{ accentColor: 'var(--ct-accent)' }}
                  />
                  <Regex className="w-3.5 h-3.5" />
                  Regex
                </label>
                <div className="pb-[3px]">
                  <ActionButton onClick={add} disabled={adding || !newKeyword.trim()}>
                    {adding ? (
                      <>
                        <RefreshCw className="w-3 h-3 inline mr-2 animate-spin" /> Adding
                      </>
                    ) : (
                      <>
                        <Plus className="w-3 h-3 inline mr-2" /> Add rule
                      </>
                    )}
                  </ActionButton>
                </div>
              </div>
              <p className="text-[11px] text-ct-ink3 mt-3 font-mono" style={{ letterSpacing: '0.02em' }}>
                Plain terms match case-insensitive substring. Regex uses the Rust `regex` engine (case-insensitive).
              </p>
              {error && (
                <div
                  className="mt-4 flex items-center gap-2 p-3 rounded-sm text-[12px]"
                  style={{
                    background: 'var(--ct-crit-soft)',
                    border: '1px solid var(--ct-crit-border)',
                    color: 'var(--ct-crit)',
                  }}
                >
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
            </div>
          </Panel>
          )}

          {/* Two-column: platform + org */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Panel>
              <PanelHead
                title="Platform-wide rules"
                meta={`Read-only · seeded by RAV`}
                right={<Globe className="w-4 h-4 text-ct-ink3" />}
              />
              <div className="p-5">
                {loading ? (
                  <div className="text-[11px] text-ct-ink3 font-mono italic">Loading…</div>
                ) : globals.length === 0 ? (
                  <div className="text-[11px] text-ct-ink3 font-mono italic">No platform defaults.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {globals.map((k) => (
                      <span
                        key={k.id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm text-[11px] font-mono uppercase text-ct-crit"
                        style={{
                          background: 'var(--ct-crit-soft)',
                          border: '1px solid var(--ct-crit-border)',
                          letterSpacing: '0.16em',
                        }}
                      >
                        <span className="w-1 h-1 rounded-full" style={{ background: 'var(--ct-crit)' }} />
                        {k.is_regex && <Regex className="w-3 h-3" />}
                        {k.keyword}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHead
                title="Organisation rules"
                meta={`${org.length} custom · applied within this org only`}
                right={<Building2 className="w-4 h-4 text-ct-ok" />}
              />
              <div>
                {loading ? (
                  <div className="p-5 text-[11px] text-ct-ink3 font-mono italic">Loading…</div>
                ) : org.length === 0 ? (
                  <div className="p-5 text-[11px] text-ct-ink3 font-mono italic">
                    No org-specific keywords yet. Add one above.
                  </div>
                ) : (
                  <ul className="divide-y divide-ct-line">
                    {org.map((k) => (
                      <li key={k.id} className="flex items-center gap-3 px-5 py-3">
                        {k.is_regex && (
                          <StatusPill tone="accent" dot={false}>Regex</StatusPill>
                        )}
                        <code className="flex-1 text-[13px] text-ct-ink font-mono truncate">{k.keyword}</code>
                        <span className="text-[10px] text-ct-ink3 font-mono tabular-nums">
                          {formatWATDate(k.created_at)}
                        </span>
                        {canMutate && (
                          <button
                            onClick={() => remove(k.id)}
                            className="p-2 rounded-sm text-ct-ink3 hover:text-ct-crit transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          </div>
        </main>
      </div>
    </div>
  )
}
