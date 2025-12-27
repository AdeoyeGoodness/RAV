'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { NarrativeTimeline } from '@/components/NarrativeTimeline'
import { getAgents, getOrganizations, getPlatformStats, getOrgStats } from '@/lib/api'
import { Activity, Shield, TrendingUp, Users, Terminal, Settings } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function DashboardPage() {
  const { user, isLoading } = useAuth()
  const [stats, setStats] = useState({ orgs: 0, agents: 0 })

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
          const stats = await getOrgStats()
          setStats({
            orgs: 1, // Only seeing their own
            agents: stats.total_agents
          })
        }
      } catch (e) {
        console.error("Failed to fetch dashboard stats:", e)
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
                  <TrendingUp className="w-4 h-4 text-slate-700" />
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <StatCard
                    label="Active Endpoints"
                    value={stats.agents.toString()}
                    icon={<Users className="w-4 h-4" />}
                    color="text-cyan-400"
                  />
                  <StatCard
                    label="Digital Entities"
                    value={stats.orgs.toString()}
                    icon={<Shield className="w-4 h-4" />}
                    color="text-purple-400"
                  />
                  <StatCard
                    label="Inbound Streams"
                    value="Nominal"
                    icon={<Activity className="w-4 h-4" />}
                    color="text-green-400"
                  />
                </div>
              </div>

              {/* Integrity Warning */}
              <div className="bg-red-500/[0.02] border border-red-500/20 rounded-[2rem] p-6 relative overflow-hidden group">
                <div className="absolute inset-0 bg-red-500/[0.02] opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex gap-4 relative z-10">
                  <div className="p-3 bg-red-500/10 rounded-xl border border-red-500/20 h-fit">
                    <Terminal className="w-5 h-5 text-red-500" />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-black text-red-500 uppercase tracking-[0.2em] flex items-center gap-2">
                      Forensic Immutability Warning
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping shadow-[0_0_10px_rgba(239,68,68,1)]" />
                    </h4>
                    <p className="text-[11px] text-slate-400 font-medium leading-[1.6]">
                      All timeline data is subject to <span className="text-red-400 font-bold">Protocol Rule 4 (Immutability)</span>. Any discrepancy between authority logs and telemetry must be escalated to platform high-command immediately.
                    </p>
                  </div>
                </div>
              </div>

              {/* Operational Status Card */}
              <div className="bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border border-white/5 rounded-[2rem] p-6 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Shield className="w-16 h-16" />
                </div>
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Platform Authority</h4>
                <div className="flex items-end justify-between">
                  <div className="space-y-1">
                    <p className="text-2xl font-black text-white">LOCKED</p>
                    <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">Integrity Verified</p>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map(i => <div key={i} className="w-1 h-3 bg-indigo-500/40 rounded-full" />)}
                  </div>
                </div>
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
