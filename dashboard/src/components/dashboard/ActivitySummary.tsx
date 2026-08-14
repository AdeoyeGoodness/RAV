'use client'

import Link from 'next/link'
import { Globe, Cpu, Chrome, HardDrive, ArrowUpRight } from 'lucide-react'
import { Panel, PanelHead, Eyebrow } from '../ct/primitives'

interface ActivitySummaryProps {
  stats: {
    networkCount: number
    processCount: number
    fileCount: number
    browserCount: number
  }
}

export function ActivitySummary({ stats }: ActivitySummaryProps) {
  const total = stats.networkCount + stats.processCount + stats.fileCount + stats.browserCount

  const rows = [
    { icon: Globe, label: 'Network', count: stats.networkCount, sub: 'DNS · TCP · UDP', color: 'var(--ct-accent)' },
    { icon: Cpu, label: 'Process', count: stats.processCount, sub: 'start · stop', color: 'var(--ct-ok)' },
    { icon: Chrome, label: 'Browser', count: stats.browserCount, sub: 'history · search', color: 'var(--ct-gold)' },
    { icon: HardDrive, label: 'File · USB', count: stats.fileCount, sub: 'transfers · access', color: 'var(--ct-warn)' },
  ]

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
        {rows.map(({ icon: Icon, label, count, sub, color }) => {
          const pct = total > 0 ? Math.max((count / total) * 100, 1.5) : 0
          return (
            <div key={label}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Icon className="w-3.5 h-3.5" style={{ color }} />
                  <span className="text-[12px] font-medium text-ct-ink">{label}</span>
                  <span
                    className="font-mono text-[10px] text-ct-ink3"
                    style={{ letterSpacing: '0.10em' }}
                  >
                    {sub}
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono tabular-nums text-[15px] text-ct-ink">{count.toLocaleString()}</span>
                  <span className="text-[10px] text-ct-ink3">events</span>
                </div>
              </div>
              <div className="h-[3px] bg-ct-line rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${pct}%`, background: color, opacity: 0.85 }}
                />
              </div>
            </div>
          )
        })}
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
