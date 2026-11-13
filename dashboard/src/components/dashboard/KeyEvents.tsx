'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { Panel, PanelHead, StatusPill } from '../ct/primitives'
import { eventServerTime } from '@/lib/eventTime'

interface KeyEvent {
  id: string
  event_type: string
  severity: string
  timestamp: string
  received_at?: string
  created_at?: string
  metadata?: any
  agent_id?: string
}

const TITLE_MAP: Record<string, string> = {
  USB_DEVICE_CONNECTED: 'USB device connected',
  USB_DEVICE_DISCONNECTED: 'USB device removed',
  SCREENSHOT_TAKEN: 'Screenshot captured',
  NETWORK_CONNECTION: 'Network connection',
  BROWSER_HISTORY: 'Browser activity',
  FILE_TRANSFER: 'File transfer',
  PROCESS_START: 'Process started',
  PROCESS_STOP: 'Process stopped',
}

function eventTitle(e: KeyEvent) {
  return TITLE_MAP[e.event_type] || e.event_type?.replace(/_/g, ' ') || 'Unknown event'
}
function eventDesc(e: KeyEvent) {
  if (e.metadata?.description) return e.metadata.description
  if (e.metadata?.device_name) return `Device: ${e.metadata.device_name}`
  if (e.metadata?.url) return e.metadata.url
  if (e.metadata?.process_name) return `Process: ${e.metadata.process_name}`
  if (e.metadata?.remote_ip) return `→ ${e.metadata.remote_ip}`
  return 'Event detected'
}
function toneOf(sev: string): 'crit' | 'warn' | 'accent' {
  if (sev === 'critical') return 'crit'
  if (sev === 'high') return 'warn'
  return 'accent'
}
function badgeOf(sev: string) {
  if (sev === 'critical') return 'CRIT'
  if (sev === 'high') return 'HIGH'
  return 'MED'
}

export function KeyEvents({ events }: { events: KeyEvent[] }) {
  return (
    <Panel className="h-full flex flex-col">
      <PanelHead
        title="Forensic alerts"
        meta="Critical + high severity · rolling 24 h"
        right={events.length > 0 && <StatusPill tone="crit">{events.length} flagged</StatusPill>}
      />

      <div className="flex-1 overflow-auto">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
            <div
              className="w-11 h-11 rounded-[3px] flex items-center justify-center mb-3"
              style={{ background: 'var(--ct-panel-hi)', border: '1px solid var(--ct-line)' }}
            >
              <AlertTriangle className="w-4 h-4 text-ct-ink3" />
            </div>
            <p className="text-[12px] text-ct-ink2 mb-1">No forensic alerts</p>
            <p className="text-[10px] text-ct-ink3">Critical &amp; high-severity events appear here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-ct-line">
            {events.slice(0, 6).map((event, i) => {
              const tone = toneOf(event.severity)
              return (
                <li key={event.id || i} className="px-5 py-3 hover:bg-ct-panel-hi transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-[13px] font-medium text-ct-ink truncate">{eventTitle(event)}</span>
                    <StatusPill tone={tone} dot={false}>{badgeOf(event.severity)}</StatusPill>
                  </div>
                  <p className="text-[11px] text-ct-ink2 truncate">{eventDesc(event)}</p>
                  <div className="flex items-center gap-2 mt-1 font-mono text-[10px] text-ct-ink3" style={{ letterSpacing: '0.06em' }}>
                    <span>{formatDistanceToNow(new Date(eventServerTime(event) ?? event.timestamp), { addSuffix: true })}</span>
                    {event.agent_id && (
                      <>
                        <span>·</span>
                        <span>{event.agent_id.substring(0, 10)}</span>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Link
        href="/telemetry"
        className="border-t border-ct-line px-5 py-3 flex items-center justify-center gap-2 text-[11px] font-mono uppercase text-ct-ink3 hover:text-ct-accent hover:bg-ct-panel-hi transition-colors"
        style={{ letterSpacing: '0.20em' }}
      >
        Open telemetry stream <ArrowUpRight className="w-3 h-3" />
      </Link>
    </Panel>
  )
}
