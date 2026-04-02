import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Home, CheckSquare, Bell, ChevronDown, ChevronRight, Flame, FileText, Monitor, Settings, LogOut, Activity, Shield, ShieldCheckIcon, Copy } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getAgents, getOrgDetails, Organization as OrgType } from '@/lib/api'

interface Agent {
  agent_id: string
  hostname: string | null
}

export default function Sidebar() {
  const pathname = usePathname()
  const { user, logout, isLoading } = useAuth()
  const [expandedTeams, setExpandedTeams] = useState<string[]>(['ProductStudio'])
  const [agents, setAgents] = useState<Agent[]>([])
  const [org, setOrg] = useState<OrgType | null>(null)
  const [copied, setCopied] = useState(false)

  const isActive = (path: string) => pathname === path

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const data = await getAgents()
        setAgents(data)
      } catch (error) {
        console.error('Failed to fetch agents for sidebar:', error)
      }
    }

    const fetchOrg = async () => {
      if (user?.role === 'org_admin') {
        try {
          const data = await getOrgDetails()
          setOrg(data)
        } catch (error) {
          console.error('Failed to fetch org details for sidebar:', error)
        }
      }
    }

    if (user) {
      if (user.role === 'org_admin') {
        fetchOrg()
      }
      fetchAgents()
    }
  }, [user])

  const toggleTeam = (team: string) => {
    setExpandedTeams(prev =>
      prev.includes(team)
        ? prev.filter(t => t !== team)
        : [...prev, team]
    )
  }

  const navItemClass = (path: string) => `flex items-center px-4 py-3 rounded-lg border transition-all ${
    isActive(path)
      ? 'bg-[#0C0E1C] border-white/[0.06] text-slate-200'
      : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
  }`

  const iconClass = (path: string) => `w-5 h-5 mr-3 transition-colors ${
    isActive(path) ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-400'
  }`

  return (
    <div className="w-64 h-screen fixed left-0 top-0 overflow-y-auto transition-colors bg-[#050510] border-r border-white/[0.06] text-slate-300">
      <div className="p-6">
        {/* Logo */}
        <div className="flex items-center mb-8">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center mr-3 bg-[#0C0E1C] border border-white/[0.06]">
            <div className="w-3.5 h-3.5 rounded-sm bg-sky-500/80"></div>
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-200">
            RAV.
          </span>
        </div>

        {/* Main Navigation */}
        <nav className="space-y-1 mb-8">
          <a href="/" className={navItemClass('/')}>
            <Home className={iconClass('/')} />
            <span className="font-medium text-sm">Home</span>
          </a>

          <a href="/telemetry" className={navItemClass('/telemetry')}>
            <Activity className={iconClass('/telemetry')} />
            <span className="font-medium text-sm">Telemetry</span>
          </a>

          {isLoading ? (
            <div className="px-4 space-y-4 py-2 mt-4">
              <div className="h-10 bg-white/[0.02] rounded-lg animate-pulse"></div>
              <div className="h-10 bg-white/[0.02] rounded-lg animate-pulse"></div>
              <div className="h-10 bg-white/[0.02] rounded-lg animate-pulse"></div>
            </div>
          ) : (
            <>
              {user?.role !== 'super_admin' && (
                <>
                  <a href="/devices" className={navItemClass('/devices')}>
                    <Monitor className={iconClass('/devices')} />
                    <span className="font-medium text-sm">Devices</span>
                  </a>
                  <a href="/documents" className={navItemClass('/documents')}>
                    <FileText className={iconClass('/documents')} />
                    <span className="font-medium text-sm">Documents</span>
                  </a>
                </>
              )}

              {user?.role === 'super_admin' && (
                <>
                  <a href="/admin" className={navItemClass('/admin')}>
                    <Settings className={iconClass('/admin')} />
                    <span className="font-medium text-sm">Management</span>
                  </a>
                  <a href="/admin/audit" className={navItemClass('/admin/audit')}>
                    <Shield className={iconClass('/admin/audit')} />
                    <span className="font-medium text-sm">Log Ledger</span>
                  </a>
                </>
              )}
            </>
          )}
        </nav>

        {!isLoading && user?.role !== 'super_admin' && (
          <>
            {/* Agents */}
            <div className="mb-8">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 px-4">Platform Agents</h3>
              <div className="space-y-1">
                <div>
                  <button
                    onClick={() => toggleTeam('ProductStudio')}
                    className="w-full flex items-center justify-between px-4 py-2 rounded-lg transition-all text-slate-400 hover:bg-white/[0.02] hover:text-slate-300"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Monitor className="w-4 h-4 text-sky-400/70" />
                      Monitoring Agents
                    </span>
                    {expandedTeams.includes('ProductStudio') ? (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-500" />
                    )}
                  </button>
                  {expandedTeams.includes('ProductStudio') && (
                    <ul className="ml-4 mt-2 space-y-1 group">
                      <div className="pt-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 px-4 mb-2">Connected Endpoints</p>
                        {agents.length === 0 ? (
                          <li className="px-4 py-2 text-[10px] text-slate-600 italic">No agents connected</li>
                        ) : (
                          agents.slice(0, 8).map(agent => (
                            <li
                              key={agent.agent_id}
                              className="px-4 py-1.5 text-xs rounded-lg cursor-pointer transition-all overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-2 text-slate-500 hover:text-sky-400 hover:bg-white/[0.02]"
                              onClick={() => window.location.href = `/devices/${agent.agent_id}`}
                            >
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" />
                              {agent.hostname || agent.agent_id.substring(0, 12)}
                            </li>
                          ))
                        )}
                      </div>
                      <li className="px-4 py-2 mt-2 text-[10px] font-bold uppercase tracking-widest rounded-lg cursor-pointer transition-all border border-transparent hover:border-white/[0.06] hover:bg-white/[0.02] text-slate-400 hover:text-slate-300" onClick={() => window.location.href = '/devices'}>
                        View All Agents →
                      </li>
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Organization Identity */}
            {user?.role === 'org_admin' && org && (
              <div className="mt-4 px-4 py-5 rounded-xl border border-white/[0.06] bg-[#0C0E1C] shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Organization</span>
                  <div className={`w-2 h-2 rounded-full ${org.status === 'active' ? 'bg-emerald-500/80' : 'bg-rose-500/80'}`} />
                </div>

                <h4 className="text-sm font-semibold text-slate-200 mb-4 whitespace-nowrap overflow-hidden text-ellipsis">
                  {org.name}
                </h4>

                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-[#050510] border border-white/[0.04]">
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5 font-bold">Enrollment Token</p>
                    <div className="flex items-center justify-between">
                      <code className="text-xs font-mono text-slate-400">
                        {org.enrollment_token.substring(0, 8)}••••
                      </code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(org.enrollment_token);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="p-1.5 rounded-md hover:bg-white/[0.06] transition-colors text-slate-500 hover:text-slate-300"
                        title="Copy Token"
                      >
                        {copied ? <ShieldCheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {user?.role === 'super_admin' && (
          <div className="mt-6 mb-8">
            <h3 className="text-[10px] font-bold uppercase tracking-widest mb-3 px-4 text-slate-500">Infrastructure</h3>
            <div className="space-y-1">
              <a
                href="/admin/compliance"
                className={`w-full flex items-center px-4 py-2.5 text-sm transition-colors rounded-lg group ${isActive('/admin/compliance') ? 'text-slate-200 bg-[#0C0E1C] border border-white/[0.06]' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02] border border-transparent'}`}
              >
                <CheckSquare className={`w-4 h-4 mr-3 ${isActive('/admin/compliance') ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-400'}`} />
                <span>Compliance Logs</span>
              </a>
              <a
                href="/admin/policies"
                className={`w-full flex items-center px-4 py-2.5 text-sm transition-colors rounded-lg group ${isActive('/admin/policies') ? 'text-slate-200 bg-[#0C0E1C] border border-white/[0.06]' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02] border border-transparent'}`}
              >
                <ShieldCheckIcon className={`w-4 h-4 mr-3 ${isActive('/admin/policies') ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-400'}`} />
                <span>System Policies</span>
              </a>
            </div>
          </div>
        )}

        {/* Logout */}
        <div className="mt-auto pt-6 border-t border-white/[0.06]">
          <button
            onClick={logout}
            className="w-full flex items-center px-4 py-2.5 rounded-lg text-rose-500/80 hover:bg-rose-500/10 hover:text-rose-400 transition-all group"
          >
            <LogOut className="w-4 h-4 mr-3" />
            <span className="font-semibold text-sm">Logout Session</span>
          </button>
        </div>
      </div>
    </div>
  )
}
