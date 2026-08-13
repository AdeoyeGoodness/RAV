'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert, Eye, Tag, RefreshCw, FileWarning } from 'lucide-react'
import { formatWAT } from '@/lib/time'

interface CriticalFile {
  id: string
  file_id: string
  file_name: string
  file_size: number
  matches: string[]
  created_at: string
  ocr_processed_at: string | null
}

interface Props {
  agentId: string
}

/**
 * Endpoint-level "Critical" tab. Lists screenshots the OCR pipeline flagged
 * because their extracted text hit one or more sensitive keywords. Clicking
 * a card opens the full image in a new tab (streams from the same backend
 * that served the login page — proxy/tunnel already established).
 */
export default function CriticalSection({ agentId }: Props) {
  const [files, setFiles] = useState<CriticalFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CriticalFile | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/agents/${agentId}/critical`,
        { credentials: 'include' }
      )
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data: CriticalFile[] = await res.json()
      setFiles(data)
    } catch (e: any) {
      setError('Unable to load critical items.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [agentId])

  const fmt = (n: number) => {
    if (n === 0) return '0 B'
    const k = 1024
    const s = ['B', 'KB', 'MB']
    const i = Math.min(s.length - 1, Math.floor(Math.log(n) / Math.log(k)))
    return `${(n / Math.pow(k, i)).toFixed(1)} ${s[i]}`
  }

  return (
    <div className="bg-slate-900/50 backdrop-blur-xl border border-rose-500/15 rounded-2xl p-7 shadow-xl">
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20 text-rose-400">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Critical</h2>
            <p className="text-sm text-slate-400 mt-1">
              Screenshots flagged by content scan (Tesseract OCR + sensitive keyword match)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {loading ? '—' : `${files.length} flagged`}
          </span>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg border border-white/10 hover:bg-white/[0.04] text-slate-400 disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="aspect-video rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-slate-500">
          <FileWarning className="w-10 h-10 text-slate-700" />
          <p className="text-sm font-medium">No critical items detected.</p>
          <p className="text-xs text-slate-600 max-w-md text-center">
            OCR scans every new screenshot as it arrives. Flagged images appear here when
            their extracted text hits one of your sensitive keywords.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {files.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelected(f)}
              className="group text-left rounded-xl overflow-hidden border border-rose-500/20 hover:border-rose-500/40 bg-black/40 transition-all"
            >
              <div className="relative aspect-video bg-black/60">
                <img
                  src={`${process.env.NEXT_PUBLIC_API_URL}/api/v1/files/${f.file_id}`}
                  alt={f.file_name}
                  loading="lazy"
                  className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                />
                <div className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-rose-300 bg-rose-500/20 border border-rose-500/30 px-2 py-1 rounded-md backdrop-blur-sm">
                  <ShieldAlert className="w-3 h-3" />
                  Critical
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                  <span className="flex items-center gap-1 text-[10px] text-white font-medium">
                    <Eye className="w-3 h-3" /> View full
                  </span>
                </div>
              </div>
              <div className="p-3 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {f.matches.slice(0, 3).map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-rose-300 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded"
                    >
                      <Tag className="w-2.5 h-2.5" />
                      {m}
                    </span>
                  ))}
                  {f.matches.length > 3 && (
                    <span className="text-[10px] text-slate-500 self-center">
                      +{f.matches.length - 3}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>{formatWAT(f.created_at)}</span>
                  <span>{fmt(f.file_size)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/85 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-w-6xl w-full max-h-[92vh] flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-slate-300">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <span className="text-sm font-medium">{selected.file_name}</span>
                {selected.matches.map((m) => (
                  <span
                    key={m}
                    className="text-[10px] font-mono text-rose-300 bg-rose-500/15 border border-rose-500/25 px-1.5 py-0.5 rounded"
                  >
                    {m}
                  </span>
                ))}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-slate-400 hover:text-white text-xl px-2"
              >
                ✕
              </button>
            </div>
            <img
              src={`${process.env.NEXT_PUBLIC_API_URL}/api/v1/files/${selected.file_id}`}
              alt={selected.file_name}
              className="w-full h-full object-contain rounded-xl border border-white/10"
            />
          </div>
        </div>
      )}
    </div>
  )
}
