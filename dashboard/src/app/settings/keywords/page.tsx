'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert, Plus, Trash2, Globe, Building2, RefreshCw, AlertCircle, Regex } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import { formatWATDate } from '@/lib/time'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'

interface Keyword {
  id: string
  organization_id: string | null
  keyword: string
  is_regex: boolean
  is_global: boolean
  created_at: string
}

/**
 * Org-scoped keyword manager for the OCR content-scanner. Globals are seeded
 * at migration time and shown here as read-only reference; org rows can be
 * added / removed live and the running backend picks up the changes on the
 * next batch (no restart needed).
 */
export default function KeywordsSettings() {
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
        // Replace an existing row on the same keyword (upsert on the backend);
        // otherwise insert alphabetically among org keywords.
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
    <div className="flex h-screen bg-[#050510] text-slate-300">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />

        <main className="flex-1 overflow-y-auto p-8 lg:p-12 mt-20 ml-64">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div>
              <div className="flex items-center gap-3 mb-2 text-rose-400">
                <ShieldAlert className="w-5 h-5" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em]">
                  OCR content scanning
                </span>
              </div>
              <h1 className="text-4xl font-extrabold text-white tracking-tight">
                Sensitive Keywords
              </h1>
              <p className="mt-3 text-slate-400 max-w-2xl text-lg leading-relaxed">
                Screenshots are OCR'd on arrival. Any image whose extracted text hits one of
                these terms is flagged <span className="text-rose-400 font-medium">Critical</span>{' '}
                on the endpoint page.
              </p>
            </div>

            {/* Add form */}
            <div className="bg-[#0C0E1C] border border-white/[0.06] rounded-2xl p-6">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[240px]">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
                    New keyword or regex
                  </label>
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !adding) add() }}
                    placeholder={newIsRegex ? 'e.g. \\b\\d{16}\\b' : 'e.g. Confidential'}
                    className="w-full px-4 py-3 bg-white/[0.02] border border-white/10 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500/40 font-mono"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400 py-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newIsRegex}
                    onChange={(e) => setNewIsRegex(e.target.checked)}
                    className="w-4 h-4 accent-rose-500"
                  />
                  <Regex className="w-4 h-4" />
                  Regex
                </label>
                <button
                  onClick={add}
                  disabled={adding || !newKeyword.trim()}
                  className="px-6 py-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {adding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                Plain terms are matched case-insensitive substring. Regex is matched
                case-insensitive with the Rust `regex` engine.
              </p>
              {error && (
                <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
            </div>

            {/* Globals — read-only reference */}
            <div className="bg-[#0C0E1C] border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05]">
                <div className="flex items-center gap-3">
                  <Globe className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold text-white">Platform defaults</span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest">
                    {globals.length} · read-only
                  </span>
                </div>
              </div>
              {loading ? (
                <div className="p-6 text-xs text-slate-500">Loading…</div>
              ) : globals.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">No global defaults.</div>
              ) : (
                <div className="flex flex-wrap gap-2 p-4">
                  {globals.map((k) => (
                    <span
                      key={k.id}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 text-xs text-slate-300 font-mono"
                    >
                      {k.is_regex && <Regex className="w-3 h-3 text-sky-400" />}
                      {k.keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Org-owned */}
            <div className="bg-[#0C0E1C] border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05]">
                <div className="flex items-center gap-3">
                  <Building2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-white">Your organization</span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest">
                    {org.length}
                  </span>
                </div>
              </div>
              {loading ? (
                <div className="p-6 text-xs text-slate-500">Loading…</div>
              ) : org.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">
                  No org-specific keywords yet. Add one above.
                </div>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {org.map((k) => (
                    <li key={k.id} className="flex items-center gap-4 px-6 py-4">
                      {k.is_regex && (
                        <span
                          className="text-[10px] font-bold text-sky-400 uppercase tracking-widest flex items-center gap-1"
                          title="Regex rule"
                        >
                          <Regex className="w-3 h-3" />
                          regex
                        </span>
                      )}
                      <code className="flex-1 text-sm text-slate-200 font-mono">{k.keyword}</code>
                      <span className="text-[10px] text-slate-600">
                        {formatWATDate(k.created_at)}
                      </span>
                      <button
                        onClick={() => remove(k.id)}
                        className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/5 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
