'use client'

import Link from 'next/link'
import { Globe, Cpu, Chrome, HardDrive, Camera, Shield, User, Terminal, Circle, ArrowUpRight } from 'lucide-react'
import { Panel, PanelHead, Eyebrow } from '../ct/primitives'

interface ActivitySummaryProps {
  /**
   * Server-supplied per-category counts. Dynamic — every category present
   * in the org's events over the window gets its own row, so the bars
   * always sum to `total`. Ordered by count desc (backend does the ORDER BY).
   */
  breakdown: Array<{ category: string; count: number }>
  /** Server-computed total; used as the denominator for bar widths. */
  total: number
}

// Category → icon + colour. Anything unknown falls back to a neutral row —
// the row still renders, just without an icon-specific colour.
const CATEGORY_META: Record<string, { icon: any; color: string; sub: string; label: string }> = {
  network:  { icon: Globe,    color: 'var(--ct-accent)', sub: 'DNS · TCP · UDP',        label: 'Network' },
  process:  { icon: Cpu,      color: 'var(--ct-ok)',     sub: 'start · stop',            label: 'Process' },
  browser:  { icon: Chrome,   color: 'var(--ct-gold)',   sub: 'history · search',        label: 'Browser' },
  file:     { icon: HardDrive,color: 'var(--ct-warn)',   sub: 'transfers · access',      label: 'File · USB' },
  system:   { icon: Camera,   color: 'var(--ct-accent)', sub: 'screenshots · lifecycle', label: 'System' },
  security: { icon: Shield,   color: 'var(--ct-crit)',   sub: 'threats · warnings',      label: 'Security' },
  user:     { icon: User,     color: 'var(--ct-ink2)',   sub: 'login · session',         label: 'User' },
  other:    { icon: Terminal, color: 'var(--ct-ink2)',   sub: 'uncategorised',           label: 'Other' },
}

function metaFor(category: string) {
  return (
    CATEGORY_META[category] ?? {
      icon: Circle,
      color: 'var(--ct-ink2)',
      sub: 'uncategorised',
      label: category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }
  )
}

export function ActivitySummary({ breakdown, total }: ActivitySummaryProps) {
  const rows = breakdown.filter((r) => r.count > 0)
  const barBase = Math.max(total, 1)

  return (
    <Panel>
      <PanelHead
        title="Activity breakdown"
        meta={`Last 24 h · ${total.toLocaleString()} events`}
        right={
          <Link
            href="/telemetry"
            className="font-mono text-[10px] uppercase text-ct-accent hover:text-ct-ink flex items-center gap-1"
            style={{ letterSpacing: '0.20em' }}
          >
            View all <ArrowUpRight className="w-3 h-3" />
          </Link>
        }
      />
      <div className="p-5 space-y-4">
        {rows.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-ct-ink3 font-mono">
            No events ingested in the last 24 hours.
          </div>
        ) : (
          rows.map(({ category, count }) => {
            const meta = metaFor(category)
            const Icon = meta.icon
            const pct = Math.max((count / barBase) * 100, 1.5)
            return (
              <div key={category}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                    <span className="text-[12px] font-medium text-ct-ink">{meta.label}</span>
                    <span
                      className="font-mono text-[10px] text-ct-ink3"
                      style={{ letterSpacing: '0.10em' }}
                    >
                      {meta.sub}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono tabular-nums text-[15px] text-ct-ink">
                      {count.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-ct-ink3">
                      {total > 0 ? `${Math.round((count / total) * 100)}%` : '0%'}
                    </span>
                  </div>
                </div>
                <div className="h-[3px] bg-ct-line rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${pct}%`, background: meta.color, opacity: 0.85 }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className="flex items-center justify-between px-5 py-3 border-t border-ct-line bg-ct-bg2">
        <Eyebrow>Total ingested</Eyebrow>
        <span className="font-mono tabular-nums text-[14px] font-medium text-ct-ink">
          {total.toLocaleString()}
        </span>
      </div>
    </Panel>
  )
}
