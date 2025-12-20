'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import { NarrativeTimeline } from '@/components/NarrativeTimeline'
import { getAgents, getOrganizations } from '@/lib/api'
import { Activity, Shield, TrendingUp, Users, Terminal, Settings } from 'lucide-react'

export default function DashboardPage() {
  const [stats, setStats] = useState({ orgs: 0, agents: 0 })

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [orgs, agents] = await Promise.all([
          getOrganizations(),
          getAgents()
        ])
        setStats({
          orgs: orgs.length,
          agents: agents.length
        })
      } catch (e) {
        console.error("Failed to fetch dashboard stats:", e)
      }
    }
    fetchStats()
  }, [])

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-purple-500/30">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <main className="flex-1 overflow-auto p-6 space-y-6 mt-20">
          {/* Dashboard Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent flex items-center gap-2">
                Operational Intelligence
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                Forensic narrative and platform authority overview.
              </p>
            </div>

            <a
              href="/admin"
              className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-900/20 transition-all active:scale-95 flex items-center gap-2 group"
            >
              <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform" />
              Manage Organizations
            </a>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_350px] gap-6">
            {/* Main Narrative Thread */}
            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-6 backdrop-blur-md shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
                <NarrativeTimeline />
              </div>
            </div>

            {/* Sidebar Widgets / Context */}
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> System Pulse
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  <StatCard label="Live Agents" value={stats.agents.toString()} icon={<Users className="w-4 h-4 text-cyan-400" />} />
                  <StatCard label="Organizations" value={stats.orgs.toString()} icon={<Shield className="w-4 h-4 text-purple-400" />} />
                  <StatCard label="Telemetry Flow" value="High" icon={<Activity className="w-4 h-4 text-green-400" />} />
                </div>
              </div>

              {/* Integrity Warning */}
              <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5">
                <div className="flex gap-3">
                  <Terminal className="w-5 h-5 text-red-500 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider">Forensic Warning</h4>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      All timeline data is subject to Rule 4 Immutability. Any discrepancy in audit logs must be reported to the platform root administrator immediately.
                    </p>
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

function StatCard({ label, value, icon }: { label: string, value: string, icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
      <div className="flex items-center gap-3">
        <div className="p-1.5 bg-slate-950 rounded-lg">{icon}</div>
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <span className="text-sm font-bold text-slate-200">{value}</span>
    </div>
  )
}
