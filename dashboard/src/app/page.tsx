'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { NarrativeTimeline } from '@/components/NarrativeTimeline'
import { getAgents, getOrganizations, getPlatformStats, getOrgStats, getOrgDetails, Organization } from '@/lib/api'
import { Activity, Shield, TrendingUp, Users, Terminal, Settings, ChevronDown, Copy, Check } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function DashboardPage() {
  const { user, isLoading } = useAuth()
  const [stats, setStats] = useState({ orgs: 0, agents: 0 })
  const [org, setOrg] = useState<Organization | null>(null)
  const [copiedToken, setCopiedToken] = useState(false)

  useEffect(() => {
    const fetchStats = async () => {
      if (!user) return;
      try {
        if (user.role === 'super_admin') {
          const stats = await getPlatformStats()
          setStats({
            orgs: stats.total_organizations,
            agents: stats.total_agents
          })
        } else {
          const [stats, orgDetails] = await Promise.all([
            getOrgStats(),
            getOrgDetails()
          ])
          setStats({
            orgs: 1,
            agents: stats.total_agents
          })
          setOrg(orgDetails)
        }
      } catch (e) {
        console.error("Failed to fetch dashboard data:", e)
      }
    }
    fetchStats()
  }, [user, isLoading])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin"></div>
          <p className="text-slate-400 font-medium animate-pulse">Verifying Security Clearance...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-purple-500/30 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64 relative">
        {/* Background Ambient Glows */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/10 blur-[120px] rounded-full pointer-events-none" />

        <Header />
        <main className="flex-1 overflow-auto p-8 space-y-8 mt-20 relative z-10 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
          {/* Dashboard Header */}
          <div className="flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-700">
            <div className="space-y-1">
              <h1 className="text-3xl font-black bg-gradient-to-r from-white via-slate-200 to-slate-500 bg-clip-text text-transparent flex items-center gap-3 tracking-tight">
                Operational Intelligence
              </h1>
              <div className="flex items-center gap-2">
                <span className="w-8 h-1 bg-gradient-to-r from-purple-500 to-transparent rounded-full" />
                <p className="text-slate-500 text-xs font-medium uppercase tracking-[0.2em]">
                  Forensic narrative and platform authority overview.
                </p>
              </div>
            </div>

            {user?.role === 'super_admin' && (
              <a
                href="/admin"
                className="px-6 py-3 bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 hover:border-purple-500/30 text-white rounded-2xl font-bold text-xs shadow-2xl backdrop-blur-md transition-all active:scale-95 flex items-center gap-2 group relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform relative z-10" />
                <span className="relative z-10 uppercase tracking-widest">Global Governance</span>
              </a>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-8 items-start">
            {/* Main Narrative Thread */}
            <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-700 delay-100">
              <div className="bg-slate-900/40 border border-white/10 rounded-[2.5rem] p-8 backdrop-blur-3xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] relative overflow-hidden group">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/40 to-transparent opacity-50" />
                <div className="absolute -inset-[500px] bg-gradient-to-tr from-purple-500/5 via-transparent to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none" />
                <NarrativeTimeline />
              </div>
            </div>

            {/* Sidebar Widgets / Context */}
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-700 delay-200">
              {/* Quick Stats */}
              <div className="bg-slate-900/40 border border-white/10 rounded-[2rem] p-6 backdrop-blur-2xl shadow-xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                    System Pulse
                  </h3>
                  <div className="relative group/filter">
                    <select
                      className="appearance-none bg-white/5 border border-white/5 rounded-xl pl-3 pr-8 py-1.5 text-[9px] font-black text-slate-400 uppercase tracking-widest outline-none focus:border-cyan-500/40 transition-all cursor-pointer backdrop-blur-3xl"
                    >
                      <option value="all">Status: All</option>
                      <option value="online">Online Only</option>
                      <option value="offline">Offline Only</option>
                    </select>
                    <ChevronDown className="w-3 h-3 text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none group-hover/filter:text-cyan-500 transition-colors" />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <StatCard
                    label="Active Endpoints"
                    value={stats.agents.toString()}
                    icon={<Users className="w-4 h-4" />}
                    color="text-cyan-400"
                  />
                  <StatCard
                    label="Forensic Nodes"
                    value={stats.orgs.toString()}
                    icon={<Shield className="w-4 h-4" />}
                    color="text-purple-400"
                  />
                  <StatCard
                    label="Stream Integrity"
                    value="Nominal"
                    icon={<Activity className="w-4 h-4" />}
                    color="text-green-400"
                  />
                </div>
              </div>

              {/* Integrity & Governance Section removed as per request */}
              <div className="space-y-4">
                {/* Organization Identity Card for Org Admins */}
                {user?.role === 'org_admin' && org && (
                  <div className="bg-slate-900/40 border border-purple-500/20 rounded-[2rem] p-6 backdrop-blur-2xl relative overflow-hidden group">
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/40 to-transparent" />
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[10px] font-black text-purple-400 uppercase tracking-[0.2em] flex items-center gap-2">
                          Organization Identity
                        </h4>
                        <div className="px-2 py-0.5 rounded-full bg-purple-500/10 text-[8px] font-bold text-purple-400 border border-purple-500/20 uppercase">
                          Authorized
                        </div>
                      </div>

                      <div className="space-y-1">
                        <p className="text-xl font-black text-white tracking-tight leading-tight">{org.name}</p>
                        <p className="text-[9px] text-slate-500 font-mono">{org.id}</p>
                      </div>

                      <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-3">
                        <div>
                          <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Enrollment Token</p>
                          <div className="flex items-center justify-between gap-2">
                            <code className="text-xs font-mono text-cyan-400 block truncate">{org.enrollment_token}</code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(org.enrollment_token);
                                setCopiedToken(true);
                                setTimeout(() => setCopiedToken(false), 2000);
                              }}
                              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-slate-400 hover:text-cyan-400 flex-shrink-0"
                            >
                              {copiedToken ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        <p className="text-[8px] text-slate-600 italic leading-relaxed">
                          Use this token to enroll new agents into your secure enclave.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }: { label: string, value: string, icon: React.ReactNode, color: string }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white/[0.02] hover:bg-white/[0.05] rounded-[1.25rem] border border-white/5 hover:border-white/10 transition-all duration-300 group/card relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-white/[0.02] to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity" />
      <div className="flex items-center gap-4 relative z-10">
        <div className={`p-2 bg-slate-950 rounded-xl border border-white/5 shadow-inner transition-colors group-hover/card:border-white/20 ${color}`}>
          {icon}
        </div>
        <div className="space-y-0.5">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
        </div>
      </div>
      <span className="text-sm font-black text-slate-200 tabular-nums relative z-10">{value}</span>
    </div>
  )
}
