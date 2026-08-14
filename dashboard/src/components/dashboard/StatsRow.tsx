'use client'

import Link from 'next/link'
import { Eyebrow } from '../ct/primitives'

interface StatsRowProps {
  stats: {
    agents: number
    events24h: number
    warnings: number
    uniqueIps: number
    screenshots: number
    criticalCount: number
    highCount: number
    mediumCount: number
    lowCount: number
  }
}

export function StatsRow({ stats }: StatsRowProps) {
  const cells: Array<{
    label: string
    value: number
    sub: string
    tone: 'ink' | 'accent' | 'ok' | 'warn' | 'crit'
    href: string
  }> = [
    { label: 'Endpoints', value: stats.agents, sub: stats.agents > 0 ? 'reporting' : 'awaiting deployment', tone: 'ink', href: '/devices' },
    { label: 'Events · 24 h', value: stats.events24h, sub: 'ingested', tone: 'accent', href: '/telemetry' },
    { label: 'Unique IPs', value: stats.uniqueIps, sub: 'observed', tone: 'ink', href: '/telemetry' },
    { label: 'Captures', value: stats.screenshots, sub: 'screenshots', tone: 'ink', href: '/telemetry' },
    { label: 'Warnings', value: stats.warnings, sub: 'medium + high', tone: 'warn', href: '/telemetry' },
    { label: 'Critical', value: stats.criticalCount, sub: 'requires review', tone: 'crit', href: '/telemetry' },
  ]

  const valueColor = (tone: 'ink' | 'accent' | 'ok' | 'warn' | 'crit') =>
    ({
      ink: 'var(--ct-ink)',
      accent: 'var(--ct-accent)',
      ok: 'var(--ct-ok)',
      warn: 'var(--ct-warn)',
      crit: 'var(--ct-crit)',
    }[tone])

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 rounded-[3px] overflow-hidden bg-ct-panel border border-ct-line">
      {cells.map((c, i) => (
        <Link
          key={c.label}
          href={c.href}
          className="transition-colors hover:bg-ct-panel-hi"
          style={{
            padding: '18px 20px',
            borderRight: i < cells.length - 1 ? '1px solid var(--ct-line)' : undefined,
            borderBottom: i < 3 ? '1px solid var(--ct-line)' : undefined,
          }}
        >
          <Eyebrow>{c.label}</Eyebrow>
          <div
            className="font-mono font-medium tabular-nums"
            style={{ fontSize: 28, color: valueColor(c.tone), letterSpacing: '-0.01em', marginTop: 6 }}
          >
            {c.value.toLocaleString()}
          </div>
          <div
            className="font-mono text-[11px] text-ct-ink3 mt-1"
            style={{ letterSpacing: '0.06em' }}
          >
            {c.sub}
          </div>
        </Link>
      ))}
    </div>
  )
}
