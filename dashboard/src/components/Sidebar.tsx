'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import {
  Home,
  Activity,
  Monitor,
  FileText,
  Archive,
  Shield,
  Bell,
  Key,
  ShieldAlert,
  Settings,
  ShieldCheck,
  CheckSquare,
  LogOut,
  ChevronRight,
  ChevronDown,
  CircleDot,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getAgents, getOrgDetails, Organization as OrgType, Agent as ApiAgent, deriveDeviceStatus } from '@/lib/api'
import { Eyebrow } from './ct/primitives'

interface SidebarAgent {
  agent_id: string
  hostname: string | null
  display_name?: string | null
  online: boolean
}

const NAV_GROUPS: Array<{
  label: string
  items: Array<{ href: string; label: string; icon: any; roles: Array<'org_admin' | 'user' | 'super_admin'> }>
}> = [
  {
    label: 'Investigation',
    items: [
      { href: '/', label: 'Command Centre', icon: Home, roles: ['org_admin', 'user'] },
      { href: '/telemetry', label: 'Telemetry', icon: Activity, roles: ['org_admin', 'user'] },
      { href: '/devices', label: 'Endpoint Registry', icon: Monitor, roles: ['org_admin', 'user'] },
      { href: '/documents', label: 'Documents', icon: FileText, roles: ['org_admin', 'user'] },
      { href: '/archives', label: 'Forensic Vault', icon: Archive, roles: ['org_admin', 'user'] },
    ],
  },
  {
    label: 'Governance',
    items: [
      { href: '/audit', label: 'Audit Trail', icon: Shield, roles: ['org_admin'] },
      { href: '/settings/notifications', label: 'Forensic Alerts', icon: Bell, roles: ['org_admin', 'user'] },
      { href: '/settings/enrollment', label: 'Deployment Tokens', icon: Key, roles: ['org_admin', 'user'] },
      { href: '/settings/keywords', label: 'Sensitive Keywords', icon: ShieldAlert, roles: ['org_admin', 'user'] },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/admin', label: 'Management', icon: Settings, roles: ['super_admin'] },
      { href: '/admin/audit', label: 'Log Ledger', icon: Shield, roles: ['super_admin'] },
      { href: '/admin/compliance', label: 'Compliance Logs', icon: CheckSquare, roles: ['super_admin'] },
      { href: '/admin/policies', label: 'System Policies', icon: ShieldCheck, roles: ['super_admin'] },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { user, logout, isLoading } = useAuth()
  const [agents, setAgents] = useState<SidebarAgent[]>([])
  const [org, setOrg] = useState<OrgType | null>(null)
  const [agentsOpen, setAgentsOpen] = useState(true)

  const isActive = (path: string) => pathname === path

  useEffect(() => {
    if (!user || user.role === 'super_admin') return

    const load = async () => {
      try {
        const data = await getAgents()
        const now = Date.now()
        setAgents(
          data.map((a: ApiAgent) => ({
            agent_id: a.agent_id,
            hostname: a.hostname,
            display_name: a.display_name ?? null,
            online: deriveDeviceStatus(a, now).kind === 'online',
          })),
        )
      } catch (err) {
        console.error('Failed to fetch agents for sidebar:', err)
      }
    }

    load()

    if (user.role === 'org_admin') {
      getOrgDetails().then(setOrg).catch((err) => console.error('Failed to fetch org for sidebar:', err))
    }
  }, [user])

  return (
    <aside
      className="w-64 h-screen fixed left-0 top-0 overflow-y-auto z-30 flex flex-col"
      style={{ background: 'var(--ct-bg)', borderRight: '1px solid var(--ct-line)' }}
    >
      {/* Brand */}
      <div className="px-5 pt-6 pb-5 border-b border-ct-line">
        <div className="flex items-center gap-3">
          <div
            className="w-[14px] h-[14px] rounded-sm"
            style={{ background: 'var(--ct-accent)', boxShadow: '0 0 0 4px var(--ct-accent-soft)' }}
          />
          <span
            className="font-mono text-[13px] font-semibold text-ct-ink"
            style={{ letterSpacing: '0.32em' }}
          >
            RAV&nbsp;/&nbsp;SYSTEMS
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Eyebrow className="text-[9px]">Command Terminal</Eyebrow>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {isLoading ? (
          <div className="px-2 space-y-2">
            <div className="h-8 rounded animate-pulse bg-ct-line" />
            <div className="h-8 rounded animate-pulse bg-ct-line" />
            <div className="h-8 rounded animate-pulse bg-ct-line" />
          </div>
        ) : (
          NAV_GROUPS.map((group) => {
            const items = group.items.filter(
              (it) => user && it.roles.includes(user.role as 'org_admin' | 'user' | 'super_admin'),
            )
            if (items.length === 0) return null
            return (
              <div key={group.label} className="mb-6">
                <div className="px-3 mb-2">
                  <Eyebrow>{group.label}</Eyebrow>
                </div>
                <div className="space-y-[2px]">
                  {items.map(({ href, label, icon: Icon }) => {
                    const active = isActive(href)
                    return (
                      <a
                        key={href}
                        href={href}
                        className="flex items-center gap-3 px-3 py-[9px] text-[13px] transition-colors group"
                        style={{
                          color: active ? 'var(--ct-ink)' : 'var(--ct-ink2)',
                          background: active ? 'var(--ct-accent-soft)' : 'transparent',
                          borderLeft: `2px solid ${active ? 'var(--ct-accent)' : 'transparent'}`,
                        }}
                      >
                        <Icon
                          className="w-[15px] h-[15px] transition-colors"
                          style={{ color: active ? 'var(--ct-accent)' : 'var(--ct-ink3)' }}
                        />
                        <span className="font-medium">{label}</span>
                      </a>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}

        {/* Live endpoint list — org users only */}
        {!isLoading && user && user.role !== 'super_admin' && (
          <div className="mt-6 border-t border-ct-line pt-5">
            <button
              onClick={() => setAgentsOpen(!agentsOpen)}
              className="w-full flex items-center justify-between px-3 mb-3 text-left"
            >
              <Eyebrow>Endpoints · {agents.length}</Eyebrow>
              {agentsOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-ct-ink3" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-ct-ink3" />
              )}
            </button>
            {agentsOpen && (
              <div className="space-y-[1px]">
                {agents.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-ct-ink3 italic">No endpoints enrolled</div>
                ) : (
                  agents.slice(0, 10).map((agent) => (
                    <a
                      key={agent.agent_id}
                      href={`/devices/${agent.agent_id}`}
                      className="flex items-center gap-2 px-3 py-[6px] text-[12px] text-ct-ink2 hover:text-ct-ink hover:bg-ct-panel transition-colors truncate"
                    >
                      <span
                        className="w-[6px] h-[6px] rounded-full shrink-0"
                        style={{ background: agent.online ? 'var(--ct-ok)' : 'var(--ct-ink4)' }}
                      />
                      <span className="truncate font-mono text-[11px]">
                        {agent.display_name || agent.hostname || agent.agent_id.slice(0, 14)}
                      </span>
                    </a>
                  ))
                )}
                {agents.length > 10 && (
                  <a
                    href="/devices"
                    className="block px-3 pt-2 text-[10px] font-mono uppercase text-ct-accent hover:text-ct-ink"
                    style={{ letterSpacing: '0.20em' }}
                  >
                    View all {agents.length} →
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Org identity card */}
      {!isLoading && user?.role === 'org_admin' && org && (
        <div className="mx-3 mb-3 p-3 rounded-[3px] border border-ct-line bg-ct-panel">
          <div className="flex items-center justify-between mb-2">
            <Eyebrow>Organization</Eyebrow>
            <span
              className="w-[6px] h-[6px] rounded-full"
              style={{ background: org.status === 'active' ? 'var(--ct-ok)' : 'var(--ct-crit)' }}
            />
          </div>
          <div className="text-[13px] text-ct-ink font-medium truncate">{org.name}</div>
          <div className="mt-1 font-mono text-[10px] text-ct-ink3" style={{ letterSpacing: '0.14em' }}>
            {org.max_agents} agents licensed
          </div>
        </div>
      )}

      {/* Logout */}
      <div className="px-3 py-3 border-t border-ct-line">
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-[9px] text-[12px] font-medium transition-colors"
          style={{ color: 'var(--ct-ink3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ct-crit)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ct-ink3)')}
        >
          <LogOut className="w-[15px] h-[15px]" />
          <span className="font-mono uppercase" style={{ letterSpacing: '0.18em' }}>
            Sign out
          </span>
        </button>
      </div>
    </aside>
  )
}
