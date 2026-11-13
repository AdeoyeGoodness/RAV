'use client'

import { useState, useEffect, useCallback } from 'react'
import { FileText, RefreshCw, Download, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { requestLogReport, getLogReports, downloadFile, type LogReport } from '@/lib/api'
import { Panel, PanelHead, ActionButton } from '@/components/ct/primitives'

function relTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function SnapCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-ct-line bg-ct-bg2 p-3">
      <p className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.14em' }}>{label}</p>
      <p className="text-[12px] font-mono text-ct-ink mt-1 truncate">{value}</p>
    </div>
  )
}

// Admin-facing "Agent report": pull this endpoint's diagnostics and show them in plain
// language. The "problems found" come from the uploaded agent.log (parsed server-side);
// the raw log sits behind a download for whoever's technical.
export default function AgentReport({ agentId, agent }: { agentId: string; agent: any }) {
  const [reports, setReports] = useState<LogReport[]>([])
  const [pulling, setPulling] = useState(false)

  const load = useCallback(async () => {
    try {
      setReports(await getLogReports(agentId))
    } catch {
      /* best-effort */
    }
  }, [agentId])

  useEffect(() => { load() }, [load])

  const latest = reports[0]
  const pending = latest?.status === 'requested'

  // Poll while a pull is in flight so "Collecting…" turns into the result.
  useEffect(() => {
    if (!pending) return
    const id = setInterval(load, 8000)
    return () => clearInterval(id)
  }, [pending, load])

  const pull = async () => {
    if (pulling || pending) return
    setPulling(true)
    try {
      await requestLogReport(agentId)
      await load()
    } catch {
      /* best-effort */
    } finally {
      setPulling(false)
    }
  }

  const download = async (fileId: string) => {
    try {
      const blob = await downloadFile(fileId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${agentId}-agent-log.log`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      /* best-effort */
    }
  }

  const problems = (latest?.status === 'ready' && latest.problems) || []
  const hasProblems = problems.length > 0

  return (
    <Panel>
      <PanelHead
        title={<span className="flex items-center gap-2"><FileText className="w-4 h-4 text-ct-accent" /> Agent report</span>}
        meta={latest ? `last pulled ${relTime(latest.completed_at || latest.requested_at)} · ${latest.trigger}` : 'no report yet'}
        right={
          <ActionButton onClick={pull} variant="primary">
            <span className="inline-flex items-center gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${(pulling || pending) ? 'animate-spin' : ''}`} />
              {pending ? 'Collecting…' : 'Pull report'}
            </span>
          </ActionButton>
        }
      />
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SnapCell label="Reporting" value={agent?.last_seen ? relTime(agent.last_seen) : '—'} />
          <SnapCell label="Version" value={agent?.agent_version || agent?.version || '—'} />
          <SnapCell label="Service" value={agent?.watchdog_service_state || 'running'} />
          <SnapCell label="Registered" value={agent?.created_at ? new Date(agent.created_at).toLocaleDateString() : '—'} />
        </div>

        <div>
          <p className="text-[11px] font-mono uppercase text-ct-ink3 mb-2" style={{ letterSpacing: '0.18em' }}>Problems found</p>
          {!latest || latest.status !== 'ready' ? (
            <div className="rounded-sm border border-dashed border-ct-line bg-ct-bg2 p-4 text-[12px] text-ct-ink3">
              {pending
                ? 'Collecting the agent log from the device… this takes up to a minute.'
                : 'Pull a report to check this device for problems.'}
            </div>
          ) : !hasProblems ? (
            <div
              className="rounded-sm border p-4 flex items-center gap-2 text-[12px]"
              style={{ borderColor: 'var(--ct-ok-border, var(--ct-line))', background: 'var(--ct-ok-soft, var(--ct-bg2))', color: 'var(--ct-ok)' }}
            >
              <CheckCircle2 className="w-4 h-4" /> No problems found in the log.
            </div>
          ) : (
            <div className="space-y-2">
              {problems.map((p, i) => {
                const crit = p.severity === 'error'
                return (
                  <div
                    key={i}
                    className="rounded-sm border p-3 flex items-start gap-3"
                    style={{ borderColor: crit ? 'var(--ct-crit-border)' : 'var(--ct-warn-border)', background: crit ? 'var(--ct-crit-soft)' : 'var(--ct-warn-soft)' }}
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: crit ? 'var(--ct-crit)' : 'var(--ct-warn)' }} />
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-ct-ink">{p.title}</p>
                      {p.detail && <p className="text-[11px] text-ct-ink3 mt-0.5">{p.detail}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {latest?.status === 'ready' && latest.file_id && (
          <button
            onClick={() => download(latest.file_id!)}
            className="inline-flex items-center gap-2 text-[11px] font-mono uppercase text-ct-ink3 hover:text-ct-accent transition-colors"
            style={{ letterSpacing: '0.14em' }}
          >
            <Download className="w-3.5 h-3.5" /> Download full technical log
          </button>
        )}
      </div>
    </Panel>
  )
}
