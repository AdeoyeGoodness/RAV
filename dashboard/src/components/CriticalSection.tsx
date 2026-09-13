'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert, Eye, Tag, RefreshCw, FileWarning, X } from 'lucide-react'
import { formatWAT } from '@/lib/time'
import { Panel, PanelHead, StatusPill } from './ct/primitives'

interface CriticalFile {
  id: string
  file_id: string
  file_name: string
  file_size: number
  matches: string[]
  created_at: string
  ocr_processed_at: string | null
  /** Count of near-identical screenshots that collapsed into this one. */
  duplicate_count?: number
}

interface Props {
  agentId: string
}

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
        { credentials: 'include' },
      )
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data: CriticalFile[] = await res.json()
      setFiles(data)
    } catch {
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
    <Panel>
      <PanelHead
        title="Critical items"
        meta="Tesseract OCR flagged screenshots"
        right={
          <div className="flex items-center gap-3">
            <StatusPill tone="crit">{loading ? '—' : `${files.length} flagged`}</StatusPill>
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded-sm text-ct-ink3 hover:text-ct-accent transition-colors disabled:opacity-40"
              style={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-line2)' }}
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      <div className="p-5">
        {error && (
          <div
            className="mb-4 p-3 rounded-sm text-[12px]"
            style={{
              background: 'var(--ct-crit-soft)',
              border: '1px solid var(--ct-crit-border)',
              color: 'var(--ct-crit)',
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array(4)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="aspect-video rounded-sm animate-pulse" style={{ background: 'var(--ct-panel-hi)' }} />
              ))}
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <FileWarning className="w-8 h-8 text-ct-ink4" />
            <p className="text-[13px] text-ct-ink2 font-medium">No critical items detected</p>
            <p className="text-[11px] text-ct-ink3 max-w-md text-center">
              OCR scans every new screenshot as it arrives. Flagged images appear here when
              their extracted text hits one of your sensitive keywords.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {files.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelected(f)}
                className="group text-left rounded-sm overflow-hidden transition-colors"
                style={{ background: 'var(--ct-bg2)', border: '1px solid var(--ct-crit-border)' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--ct-crit)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--ct-crit-border)')}
              >
                <div className="relative aspect-video" style={{ background: '#000' }}>
                  <img
                    src={`${process.env.NEXT_PUBLIC_API_URL}/api/v1/files/${f.file_id}`}
                    alt={f.file_name}
                    loading="lazy"
                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                  />
                  <div
                    className="absolute top-2 left-2 flex items-center gap-1 text-[10px] font-mono uppercase text-ct-crit px-2 py-1 rounded-sm"
                    style={{
                      background: 'rgba(0,0,0,0.7)',
                      border: '1px solid var(--ct-crit)',
                      backdropFilter: 'blur(4px)',
                      letterSpacing: '0.18em',
                    }}
                  >
                    <ShieldAlert className="w-3 h-3" />
                    Critical
                  </div>
                  {f.duplicate_count && f.duplicate_count > 0 ? (
                    <div
                      className="absolute top-2 right-2 text-[10px] font-mono uppercase text-ct-ink px-2 py-1 rounded-sm"
                      style={{
                        background: 'rgba(0,0,0,0.65)',
                        border: '1px solid var(--ct-line2)',
                        backdropFilter: 'blur(4px)',
                        letterSpacing: '0.14em',
                      }}
                      title="Near-identical captures collapsed into this one"
                    >
                      +{f.duplicate_count} similar
                    </div>
                  ) : null}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3"
                    style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}
                  >
                    <span className="flex items-center gap-1 text-[11px] text-white font-medium">
                      <Eye className="w-3 h-3" /> View full
                    </span>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {f.matches.slice(0, 3).map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-ct-crit px-1.5 py-0.5 rounded"
                        style={{
                          background: 'var(--ct-crit-soft)',
                          border: '1px solid var(--ct-crit-border)',
                          letterSpacing: '0.14em',
                        }}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {m}
                      </span>
                    ))}
                    {f.matches.length > 3 && (
                      <span className="text-[10px] text-ct-ink3 self-center font-mono">
                        +{f.matches.length - 3}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-ct-ink3 font-mono tabular-nums">
                    <span>{formatWAT(f.created_at)}</span>
                    <span>{fmt(f.file_size)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
          onClick={() => setSelected(null)}
        >
          <div
            className="max-w-6xl w-full max-h-[92vh] flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-ct-ink2">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-ct-crit" />
                <span className="text-[13px] font-medium text-ct-ink">{selected.file_name}</span>
                {selected.matches.map((m) => (
                  <span
                    key={m}
                    className="text-[10px] font-mono uppercase text-ct-crit px-1.5 py-0.5 rounded"
                    style={{
                      background: 'var(--ct-crit-soft)',
                      border: '1px solid var(--ct-crit-border)',
                      letterSpacing: '0.14em',
                    }}
                  >
                    {m}
                  </span>
                ))}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-ct-ink2 hover:text-ct-ink p-2 rounded-sm"
                style={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-line2)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={`${process.env.NEXT_PUBLIC_API_URL}/api/v1/files/${selected.file_id}`}
              alt={selected.file_name}
              className="w-full h-full object-contain rounded-sm"
              style={{ border: '1px solid var(--ct-line2)' }}
            />
          </div>
        </div>
      )}
    </Panel>
  )
}
