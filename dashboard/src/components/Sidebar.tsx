'use client'

import { useState, useEffect } from 'react'
import { Home, CheckSquare, Bell, ChevronDown, ChevronRight, Flame, FileText, Monitor, Settings, LogOut, Activity } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getSystemHealth } from '@/lib/api'

export default function Sidebar() {
  const { user, logout } = useAuth()
  const [expandedTeams, setExpandedTeams] = useState<string[]>(['ProductStudio'])
  const [expandedWorkspace, setExpandedWorkspace] = useState<string[]>(['Fireart Studio'])
  const [health, setHealth] = useState<any>(null)

  useEffect(() => {
    if (user?.role === 'super_admin') {
      const fetchHealth = async () => {
        try {
          const data = await getSystemHealth()
          setHealth(data)
        } catch (error) {
          console.error('Failed to fetch platform health:', error)
        }
      }

      fetchHealth()
      const interval = setInterval(fetchHealth, 5000)
      return () => clearInterval(interval)
    }
  }, [user])

  const toggleTeam = (team: string) => {
    setExpandedTeams(prev =>
      prev.includes(team)
        ? prev.filter(t => t !== team)
        : [...prev, team]
    )
  }

  const toggleWorkspace = (workspace: string) => {
    setExpandedWorkspace(prev =>
      prev.includes(workspace)
        ? prev.filter(w => w !== workspace)
        : [...prev, workspace]
    )
  }

  return (
    <div className="w-64 h-screen fixed left-0 top-0 overflow-y-auto transition-colors" style={{ backgroundColor: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
      <div className="p-6">
        {/* Logo */}
        <div className="flex items-center mb-8">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center mr-2 cyber-glow" style={{ background: 'linear-gradient(to bottom right, var(--accent-cyan), var(--accent-purple))' }}>
            <div className="w-4 h-4 rounded transition-colors" style={{ backgroundColor: 'var(--text-primary)' }}></div>
          </div>
          <span className="text-xl font-semibold bg-clip-text text-transparent" style={{ background: 'linear-gradient(to right, var(--accent-cyan), var(--accent-purple))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>RAV.</span>
        </div>

        {/* Main Navigation */}
        <nav className="space-y-2 mb-8">
          <a href="/" className="flex items-center px-4 py-3 rounded-lg border transition-all cyber-glow-purple" style={{ background: 'linear-gradient(to right, rgba(108, 92, 231, 0.3), rgba(0, 217, 255, 0.2))', borderColor: 'var(--accent-cyan)', color: 'var(--text-primary)' }}>
            <Home className="w-5 h-5 mr-3 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
            <span className="font-medium">Home</span>
          </a>
          {user?.role !== 'super_admin' && (
            <>
              <a href="/devices" className="flex items-center px-4 py-3 rounded-lg transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderColor = 'var(--accent-purple)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
                <Monitor className="w-5 h-5 mr-3" />
                <span>Devices</span>
              </a>
              <a href="/documents" className="flex items-center px-4 py-3 rounded-lg transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderColor = 'var(--accent-purple)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
                <FileText className="w-5 h-5 mr-3" />
                <span>Documents</span>
              </a>
            </>
          )}

          {user?.role === 'super_admin' && (
            <a href="/admin" className="flex items-center px-4 py-3 rounded-lg transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderColor = 'var(--accent-purple)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
              <Settings className="w-5 h-5 mr-3" style={{ color: 'var(--accent-cyan)' }} />
              <span className="font-semibold text-white">Management</span>
            </a>
          )}
          <a href="#" className="flex items-center px-4 py-3 rounded-lg transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderColor = 'var(--accent-purple)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
            <Bell className="w-5 h-5 mr-3" />
            <span>Alerts</span>
          </a>

          {user?.role === 'super_admin' && (
            <div className="mt-8 px-4 py-6 rounded-2xl border border-white/5 bg-gradient-to-b from-white/5 to-transparent shadow-xl shadow-black/20">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-widest text-cyan-500/80">Platform Health</span>
                <div className="flex items-center">
                  <div className={`w-2 h-2 rounded-full ${health?.database_connected ? 'bg-[#00FF88]' : 'bg-red-500'} animate-pulse mr-2`} />
                  <span className={`text-[10px] ${health?.database_connected ? 'text-[#00FF88]/80' : 'text-red-500/80'} font-mono`}>
                    {health?.status || 'LOADING...'}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center text-[11px] text-gray-400 mb-1">
                    <span>CPU LOAD</span>
                    <span>{health ? `${health.cpu_load.toFixed(1)}%` : '--%'}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-500/40 transition-all duration-1000"
                      style={{ width: health ? `${health.cpu_load}%` : '0%' }}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-white/5">
                  <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-tighter">Global Orchestrator</p>
                  <div className="flex items-center text-xs text-white/90">
                    <div className="p-1 px-2 rounded bg-purple-500/10 text-purple-400 mr-2 text-[10px] font-mono border border-purple-500/20">
                      {health?.orchestrator_version || 'v1.0.0'}
                    </div>
                    <span className="text-gray-400">Stable</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </nav>

        {user?.role !== 'super_admin' && (
          <>
            {/* Favorites */}
            <div className="mb-8">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 px-4 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Favorites</h3>
              <ul className="space-y-1">
                <li className="px-4 py-2 rounded-lg cursor-pointer transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderLeft = '2px solid var(--accent-cyan)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeft = 'none'; }}>
                  • Active Agents
                </li>
              </ul>
            </div>

            {/* Teams */}
            <div className="mb-8">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 px-4 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Agents</h3>
              <div className="space-y-1">
                <div>
                  <button
                    onClick={() => toggleTeam('ProductStudio')}
                    className="w-full flex items-center justify-between px-4 py-2 rounded-lg transition-all"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <span>Monitoring Agents</span>
                    {expandedTeams.includes('ProductStudio') ? (
                      <ChevronDown className="w-4 h-4 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                  {expandedTeams.includes('ProductStudio') && (
                    <ul className="ml-4 mt-1 space-y-1">
                      <li className="px-4 py-2 rounded-lg cursor-pointer transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderLeft = '2px solid var(--accent-cyan)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeft = 'none'; }}>
                        USB Monitoring
                      </li>
                      <li className="px-4 py-2 rounded-lg cursor-pointer transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderLeft = '2px solid var(--accent-cyan)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeft = 'none'; }}>
                        Network Events
                      </li>
                      <li className="px-4 py-2 rounded-lg cursor-pointer transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderLeft = '2px solid var(--accent-cyan)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderLeft = 'none'; }}>
                        System Activity
                      </li>
                      <li className="px-4 py-2 text-sm rounded-lg cursor-pointer transition-all" style={{ color: 'var(--text-tertiary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                        View All
                      </li>
                    </ul>
                  )}
                </div>
                <button
                  onClick={() => toggleTeam('AnimateStudio')}
                  className="w-full flex items-center justify-between px-4 py-2 rounded-lg transition-all"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <span>Forensics Tools</span>
                  {expandedTeams.includes('AnimateStudio') ? (
                    <ChevronDown className="w-4 h-4 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Workspace */}
            <div className="mb-8">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 px-4 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Workspace</h3>
              <div className="space-y-1">
                <button
                  onClick={() => toggleWorkspace('Fireart Studio')}
                  className="w-full flex items-center justify-between px-4 py-2 border rounded-lg cyber-glow-purple transition-all"
                  style={{ background: 'linear-gradient(to right, rgba(108, 92, 231, 0.3), rgba(0, 217, 255, 0.2))', borderColor: 'var(--accent-cyan)', color: 'var(--text-primary)' }}
                >
                  <div className="flex items-center">
                    <Flame className="w-4 h-4 mr-2 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
                    <span>RAV Platform</span>
                  </div>
                  {expandedWorkspace.includes('Fireart Studio') ? (
                    <ChevronDown className="w-4 h-4 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {user?.role === 'super_admin' && (
          <div className="mt-4 mb-8">
            <h3 className="text-[10px] font-bold uppercase tracking-widest mb-4 px-4 text-gray-600">Infrastructure</h3>
            <div className="space-y-1">
              <button className="w-full flex items-center px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors group">
                <CheckSquare className="w-4 h-4 mr-3 text-gray-600 group-hover:text-cyan-400" />
                <span>Compliance Logs</span>
              </button>
              <button className="w-full flex items-center px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors group">
                <Settings className="w-4 h-4 mr-3 text-gray-600 group-hover:text-cyan-400" />
                <span>System Policies</span>
              </button>
            </div>
          </div>
        )}

        {/* Logout */}
        <div className="mt-auto pt-8 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <button
            onClick={logout}
            className="w-full flex items-center px-4 py-3 rounded-lg text-red-500 hover:bg-red-500/10 transition-all"
          >
            <LogOut className="w-5 h-5 mr-3" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  )
}
