'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, Server, ArrowUpRight } from 'lucide-react'
import { Agent } from '@/lib/api'
import { Panel, PanelHead, StatusPill } from '../ct/primitives'

interface EnrolledAgentsProps {
  agents: Agent[]
}

function minutesSince(a: Agent) {
  return (a.server_time_ms - a.last_seen_ms) / 60000
}
function statusTone(a: Agent): 'ok' | 'warn' | 'idle' {
  const m = minutesSince(a)
  if (m < 5) return 'ok'
  if (m < 30) return 'warn'
  return 'idle'
}
function statusLabel(a: Agent) {
  const m = minutesSince(a)
  if (m < 5) return 'Online'
  if (m < 30) return 'Idle'
  return 'Offline'
}
function lastSeen(a: Agent) {
  const ms = a.server_time_ms - a.last_seen_ms
  const mins = Math.floor(ms / 60000)
  const hrs = Math.floor(ms / 3600000)
  const days = Math.floor(ms / 86400000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  if (hrs < 24) return `${hrs}h`
  return `${days}d`
}

export function EnrolledAgents({ agents }: EnrolledAgentsProps) {
  const [filter, setFilter] = useState('')
  const onlineCount = agents.filter((a) => minutesSince(a) < 5).length
  const filtered = agents.filter(
    (a) => !filter || (a.hostname || a.display_name || a.agent_id).toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <Panel className="h-full flex flex-col">
      <PanelHead
        title="Endpoint registry"
        meta={`${agents.length} enrolled · ${onlineCount} online`}
        right={
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ct-ink3" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter…"
              className="w-40 pl-7 pr-2 py-1 rounded-sm text-[11px] font-mono text-ct-ink placeholder:text-ct-ink3 focus:outline-none"
              style={{
                background: 'var(--ct-bg)',
                border: '1px solid var(--ct-line2)',
                letterSpacing: '0.02em',
              }}
            />
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        {filtered.length > 0 ? (
          <ul className="divide-y divide-ct-line">
            {filtered.slice(0, 10).map((agent) => (
              <li key={agent.id}>
                <Link
                  href={`/devices/${agent.agent_id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-ct-panel-hi transition-colors group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ct-ink group-hover:text-ct-accent truncate">
                      {agent.display_name || agent.hostname || 'Unknown host'}
                    </div>
                    <div
                      className="font-mono text-[10px] text-ct-ink3 truncate mt-1"
                      style={{ letterSpacing: '0.06em' }}
                    >
                      {agent.agent_id.substring(0, 20)}
                    </div>
                  </div>
                  {agent.campaign && (
                    <StatusPill tone="accent" dot={false}>{agent.campaign}</StatusPill>
                  )}
                  <StatusPill tone={statusTone(agent)}>{statusLabel(agent)}</StatusPill>
                  <span className="font-mono text-[10px] text-ct-ink3 w-14 text-right tabular-nums">
                    {lastSeen(agent)}
                  </span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-ct-ink3 group-hover:text-ct-accent transition-colors" />
                </Link>
              </li>
            ))}
          </ul>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div
              className="w-12 h-12 rounded-[3px] flex items-center justify-center mb-3"
              style={{ background: 'var(--ct-panel-hi)', border: '1px solid var(--ct-line)' }}
            >
              <Server className="w-5 h-5 text-ct-ink3" />
            </div>
            <p className="text-[12px] text-ct-ink2">No endpoints enrolled</p>
            <p className="text-[10px] text-ct-ink3 mt-1">Deploy the RAV agent to begin monitoring.</p>
          </div>
        ) : (
          <div className="text-center py-8 text-[11px] text-ct-ink3">No matches for &ldquo;{filter}&rdquo;</div>
        )}
      </div>

      <div className="border-t border-ct-line px-5 py-3 flex items-center justify-between">
        <span className="font-mono text-[10px] text-ct-ink3" style={{ letterSpacing: '0.06em' }}>
          {agents.length > 0 ? `${filtered.length} of ${agents.length} shown` : 'Awaiting deployment'}
        </span>
        <Link
          href="/devices"
          className="font-mono text-[10px] uppercase text-ct-accent hover:text-ct-ink flex items-center gap-1"
          style={{ letterSpacing: '0.20em' }}
        >
          Full registry <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
    </Panel>
  )
}
