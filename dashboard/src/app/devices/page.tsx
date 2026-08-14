'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { getAgents, Agent } from '@/lib/api'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import { useAuth } from '@/contexts/AuthContext'
import { formatWATDate } from '@/lib/time'
import { Panel, PanelHead, SectionHead, StatusPill, Chip, Eyebrow } from '@/components/ct/primitives'

// Drift-proof status derivation — matches deriveDeviceStatus() in lib/api.ts.
// Kept inline because that helper returns a slightly different shape than
// the fleet-strip tone map we want here.
type FleetStatus = 'online' | 'idle' | 'stopped' | 'removed' | 'tampered' | 'killed' | 'offline'
function fleetStatus(agent: Agent): FleetStatus {
  const msSince = agent.server_time_ms - agent.last_seen_ms
  const mins = msSince / 60000
  if (mins < 5) return 'online'
  if (mins < 30) return 'idle'

  const ageMs = (ts: string | null | undefined) =>
    ts ? Math.max(0, agent.server_time_ms - new Date(ts).getTime()) : Number.POSITIVE_INFINITY
  const watchdogFresh = ageMs(agent.watchdog_last_seen) < 15 * 60 * 1000
  const lifecycleFresh = ageMs(agent.last_lifecycle_at) < 30 * 60 * 1000

  if (lifecycleFresh && (agent.last_lifecycle_state === 'stopping' || agent.last_lifecycle_state === 'uninstalling')) {
    return 'stopped'
  }
  if (watchdogFresh) {
    const svc = agent.watchdog_service_state
    const bin = agent.watchdog_binary_present
    if (svc === 'NotInstalled' && bin === false) return 'removed'
    if (svc === 'NotInstalled' && bin === true) return 'tampered'
    if (svc === 'Stopped' && bin) return 'killed'
    if (svc === 'Running') return 'online'
  }
  return 'offline'
}

const statusPillTone: Record<FleetStatus, 'ok' | 'warn' | 'crit' | 'accent' | 'idle'> = {
  online: 'ok',
  idle: 'accent',
  stopped: 'warn',
  killed: 'warn',
  tampered: 'crit',
  removed: 'crit',
  offline: 'idle',
}

function lastSeenShort(agent: Agent) {
  const diffMs = agent.server_time_ms - agent.last_seen_ms
  const mins = Math.floor(diffMs / 60000)
  const hrs = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  if (hrs < 24) return `${hrs}h`
  return `${days}d`
}

export default function DevicesPage() {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | FleetStatus>('all')

  useEffect(() => {
    if (user) {
      loadAgents()
      const interval = setInterval(loadAgents, 30000)
      return () => clearInterval(interval)
    }
  }, [user])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-ct-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-8 h-8 rounded-full animate-spin"
            style={{
              borderWidth: 2,
              borderStyle: 'solid',
              borderColor: 'var(--ct-line2)',
              borderTopColor: 'var(--ct-accent)',
            }}
          />
          <span
            className="text-[10px] font-mono uppercase text-ct-ink3"
            style={{ letterSpacing: '0.28em' }}
          >
            Scanning endpoints
          </span>
        </div>
      </div>
    )
  }

  const loadAgents = async () => {
    try {
      const agentsData = await getAgents()
      setAgents(agentsData)
    } catch (error) {
      console.error('Failed to load agents:', error)
    } finally {
      setLoading(false)
    }
  }

  const campaigns = useMemo(
    () => Array.from(new Set(agents.map((a) => a.campaign).filter((c): c is string => !!c))).sort(),
    [agents],
  )

  const fleetCounts = useMemo(() => {
    const c: Record<FleetStatus, number> = {
      online: 0,
      idle: 0,
      stopped: 0,
      killed: 0,
      tampered: 0,
      removed: 0,
      offline: 0,
    }
    for (const a of agents) c[fleetStatus(a)]++
    return c
  }, [agents])

  const flagged = fleetCounts.tampered + fleetCounts.removed + fleetCounts.killed

  const filteredAgents = agents.filter((agent) => {
    if (campaignFilter === '__none__') {
      if (agent.campaign) return false
    } else if (campaignFilter !== 'all') {
      if (agent.campaign !== campaignFilter) return false
    }
    if (statusFilter !== 'all' && fleetStatus(agent) !== statusFilter) return false
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      agent.agent_id.toLowerCase().includes(q) ||
      agent.hardware_fingerprint.toLowerCase().includes(q) ||
      (agent.hostname && agent.hostname.toLowerCase().includes(q)) ||
      (agent.display_name && agent.display_name.toLowerCase().includes(q)) ||
      (agent.campaign && agent.campaign.toLowerCase().includes(q))
    )
  })

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />

        <main className="flex-1 overflow-auto p-8 space-y-6 mt-20">
          <SectionHead
            eyebrow={`Endpoint registry · ${agents.length} agents across ${campaigns.length || 'no'} campaign${campaigns.length === 1 ? '' : 's'}`}
            title="Devices"
          />

          {/* Fleet strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 rounded-[3px] overflow-hidden bg-ct-panel border border-ct-line">
            <FleetCell label="Total" value={agents.length} sub="enrolled" tone="ink" />
            <FleetCell label="Online" value={fleetCounts.online} sub={`${agents.length ? Math.round((fleetCounts.online / agents.length) * 100) : 0}% reporting`} tone="accent" />
            <FleetCell label="Idle" value={fleetCounts.idle} sub="under 30 m" tone="ok" />
            <FleetCell label="Offline" value={fleetCounts.offline + fleetCounts.stopped} sub="after hours" tone="idle" />
            <FleetCell label="Flagged" value={flagged} sub="tampered / killed / removed" tone="crit" />
            <FleetCell label="Campaigns" value={campaigns.length} sub={campaigns.slice(0, 3).join(' · ') || 'none'} tone="ink" last />
          </div>

          {/* Filter bar */}
          <Panel padding={false}>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-ct-line bg-ct-bg2">
              <div className="relative flex-1 min-w-[260px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ct-ink3" />
                <input
                  type="text"
                  placeholder="Search hostname, user, fingerprint, IP, campaign…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-[7px] rounded-sm text-[12px] font-mono text-ct-ink placeholder:text-ct-ink3 focus:outline-none"
                  style={{
                    background: 'var(--ct-panel)',
                    border: '1px solid var(--ct-line2)',
                    letterSpacing: '0.02em',
                  }}
                />
              </div>
              <select
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="px-3 py-[7px] rounded-sm text-[11px] font-mono uppercase text-ct-ink2 focus:outline-none"
                style={{
                  background: 'var(--ct-panel)',
                  border: '1px solid var(--ct-line2)',
                  letterSpacing: '0.14em',
                }}
              >
                <option value="all">All campaigns ({agents.length})</option>
                {campaigns.map((c) => (
                  <option key={c} value={c}>
                    {c} ({agents.filter((a) => a.campaign === c).length})
                  </option>
                ))}
                <option value="__none__">No campaign</option>
              </select>
              <div className="flex items-center gap-1">
                {(['all', 'online', 'idle', 'offline', 'tampered'] as const).map((s) => {
                  const count = s === 'all' ? agents.length : fleetCounts[s as FleetStatus] || 0
                  return (
                    <Chip
                      key={s}
                      tone={s === 'tampered' ? 'crit' : s === 'online' ? 'ok' : s === 'idle' ? 'accent' : 'idle'}
                      active={statusFilter === s}
                      onClick={() => setStatusFilter(s as any)}
                    >
                      {s}
                      <span className="text-ct-ink3 ml-1 tabular-nums">{count}</span>
                    </Chip>
                  )
                })}
              </div>
            </div>

            {/* Table */}
            {loading ? (
              <div className="text-center py-16 text-[11px] text-ct-ink3 font-mono">Loading devices…</div>
            ) : filteredAgents.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-[13px] text-ct-ink2 mb-1">No devices match this filter</p>
                <p className="text-[11px] text-ct-ink3 font-mono">
                  {searchQuery ? 'Try a different search query' : 'No devices are currently registered'}
                </p>
              </div>
            ) : (
              <div>
                {/* Table headers */}
                <div
                  className="grid gap-3 px-6 py-3 border-b border-ct-line bg-ct-bg2 font-mono text-[10px] uppercase text-ct-ink3"
                  style={{
                    gridTemplateColumns: '1.8fr 100px 120px 130px 100px 110px 100px 24px',
                    letterSpacing: '0.20em',
                  }}
                >
                  <div>Host · User</div>
                  <div>Campaign</div>
                  <div>Fingerprint</div>
                  <div>Registered</div>
                  <div>Agent</div>
                  <div>Status</div>
                  <div className="text-right">Last seen</div>
                  <div />
                </div>
                {/* Rows */}
                {filteredAgents.map((agent) => {
                  const st = fleetStatus(agent)
                  return (
                    <button
                      key={agent.id}
                      onClick={() => router.push(`/devices/${agent.agent_id}`)}
                      className="w-full grid gap-3 items-center px-6 py-[14px] border-b border-ct-line hover:bg-ct-panel-hi transition-colors text-left"
                      style={{ gridTemplateColumns: '1.8fr 100px 120px 130px 100px 110px 100px 24px' }}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-ct-ink truncate">
                          {agent.display_name || agent.hostname || agent.agent_id.substring(0, 24)}
                        </div>
                        <div
                          className="font-mono text-[10px] text-ct-ink3 truncate mt-1"
                          style={{ letterSpacing: '0.06em' }}
                        >
                          {agent.agent_id.substring(0, 28)}
                          {agent.agent_id.length > 28 ? '…' : ''}
                        </div>
                      </div>
                      <div>
                        {agent.campaign ? (
                          <StatusPill tone="accent" dot={false}>
                            {agent.campaign}
                          </StatusPill>
                        ) : (
                          <span className="text-[10px] text-ct-ink3 font-mono">—</span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-ct-ink2 truncate tabular-nums">
                        {agent.hardware_fingerprint.substring(0, 14)}…
                      </div>
                      <div className="font-mono text-[11px] text-ct-ink2 truncate">
                        {formatWATDate(agent.created_at)}
                      </div>
                      <div className="font-mono text-[11px] text-ct-ink3 truncate">
                        {agent.watchdog_version || '—'}
                      </div>
                      <StatusPill tone={statusPillTone[st]}>{st}</StatusPill>
                      <div className="font-mono text-[11px] text-ct-ink3 text-right tabular-nums">
                        {lastSeenShort(agent)}
                      </div>
                      <div className="text-ct-ink3 text-right">→</div>
                    </button>
                  )
                })}
              </div>
            )}
          </Panel>
        </main>
      </div>
    </div>
  )
}

function FleetCell({
  label,
  value,
  sub,
  tone,
  last,
}: {
  label: string
  value: number
  sub: string
  tone: 'ink' | 'accent' | 'ok' | 'warn' | 'crit' | 'idle'
  last?: boolean
}) {
  const color = {
    ink: 'var(--ct-ink)',
    accent: 'var(--ct-accent)',
    ok: 'var(--ct-ok)',
    warn: 'var(--ct-warn)',
    crit: 'var(--ct-crit)',
    idle: 'var(--ct-ink3)',
  }[tone]
  return (
    <div
      style={{
        padding: '18px 20px',
        borderRight: last ? undefined : '1px solid var(--ct-line)',
      }}
    >
      <Eyebrow>{label}</Eyebrow>
      <div
        className="font-mono font-medium tabular-nums"
        style={{ fontSize: 28, color, letterSpacing: '-0.01em', marginTop: 6 }}
      >
        {value.toLocaleString()}
      </div>
      <div
        className="font-mono text-[11px] text-ct-ink3 mt-1 truncate"
        style={{ letterSpacing: '0.06em' }}
      >
        {sub}
      </div>
    </div>
  )
}
