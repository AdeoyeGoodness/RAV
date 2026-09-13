'use client'

import Link from 'next/link'
import { ArrowUpRight, Monitor } from 'lucide-react'
import { Panel, PanelHead, Eyebrow } from '../ct/primitives'
import { Counter } from '../ct/Counter'

interface Contributor {
  agent_id: string
  hostname: string | null
  display_name: string | null
  count: number
}

/**
 * Top event-producing endpoints over the window. Renders as a horizontal
 * bar chart so analysts can *see* that a small slice of the fleet produces
 * most of the volume — suppresses the "how can 26 online devices produce
 * 1000 events?" confusion by making the distribution visible.
 */
export function TopContributors({
  contributors,
  total,
}: {
  contributors: Contributor[]
  total: number
}) {
  const max = contributors.length > 0 ? contributors[0].count : 1
  const covered = contributors.reduce((acc, c) => acc + c.count, 0)
  const pctCovered = total > 0 ? Math.round((covered / total) * 100) : 0

  return (
    <Panel>
      <PanelHead
        title="Top contributing endpoints"
        meta={
          contributors.length > 0
            ? `Top ${contributors.length} produced ${pctCovered}% of the ${total.toLocaleString()} events in the last 24 h`
            : 'No event contributors in the last 24 h'
        }
        right={
          <Link
            href="/devices"
            className="font-mono text-[10px] uppercase text-ct-accent hover:text-ct-ink flex items-center gap-1"
            style={{ letterSpacing: '0.20em' }}
          >
            All endpoints <ArrowUpRight className="w-3 h-3" />
          </Link>
        }
      />
      <div className="p-5">
        {contributors.length === 0 ? (
          <div className="text-center py-8 text-[11px] text-ct-ink3 font-mono">
            Waiting for telemetry.
          </div>
        ) : (
          <ul className="space-y-3">
            {contributors.map((c) => {
              const label = c.display_name || c.hostname || c.agent_id.slice(0, 16)
              const barPct = Math.max((c.count / max) * 100, 2)
              const share = total > 0 ? Math.round((c.count / total) * 100) : 0
              return (
                <li key={c.agent_id}>
                  <Link
                    href={`/devices/${c.agent_id}`}
                    className="block group hover:bg-ct-panel-hi transition-colors -mx-2 px-2 py-2 rounded-sm"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Monitor className="w-3.5 h-3.5 text-ct-ink3 group-hover:text-ct-accent" />
                        <span className="text-[13px] text-ct-ink font-medium truncate">
                          {label}
                        </span>
                        <span
                          className="font-mono text-[10px] text-ct-ink3 truncate"
                          style={{ letterSpacing: '0.06em' }}
                        >
                          {c.agent_id.slice(0, 12)}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2 shrink-0">
                        <span className="font-mono tabular-nums text-[13px] text-ct-ink">
                          <Counter value={c.count} />
                        </span>
                        <span className="font-mono text-[10px] text-ct-ink3 tabular-nums w-8 text-right">
                          {share}%
                        </span>
                      </div>
                    </div>
                    <div className="h-[3px] bg-ct-line rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${barPct}%`, background: 'var(--ct-accent)', opacity: 0.85 }}
                      />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="border-t border-ct-line px-5 py-3 flex items-center justify-between">
        <Eyebrow>Coverage</Eyebrow>
        <span className="font-mono text-[11px] text-ct-ink2 tabular-nums">
          <Counter value={covered} /> / <Counter value={total} /> events shown
        </span>
      </div>
    </Panel>
  )
}
