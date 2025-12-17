'use client'

import { useState } from 'react'
import { Home, CheckSquare, Bell, ChevronDown, ChevronRight, Flame, FileText, Monitor } from 'lucide-react'

export default function Sidebar() {
  const [expandedTeams, setExpandedTeams] = useState<string[]>(['ProductStudio'])
  const [expandedWorkspace, setExpandedWorkspace] = useState<string[]>(['Fireart Studio'])

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
          <a href="/devices" className="flex items-center px-4 py-3 rounded-lg transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderColor = 'var(--accent-purple)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
            <Monitor className="w-5 h-5 mr-3" />
            <span>Devices</span>
          </a>
          <a href="/documents" className="flex items-center px-4 py-3 rounded-lg transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderColor = 'var(--accent-purple)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
            <FileText className="w-5 h-5 mr-3" />
            <span>Documents</span>
          </a>
          <a href="#" className="flex items-center px-4 py-3 rounded-lg transition-all" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(108, 92, 231, 0.2)'; e.currentTarget.style.borderColor = 'var(--accent-purple)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
            <Bell className="w-5 h-5 mr-3" />
            <span>Alerts</span>
          </a>
        </nav>

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
        <div>
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
      </div>
    </div>
  )
}

