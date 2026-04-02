'use client'

import { useState, useEffect } from 'react'
import { Search, Sun, Moon } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'

export default function Header() {
  const { theme, toggleTheme } = useTheme()
  const { user, isLoading } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const getUserDisplayName = () => {
    return user?.email?.split('@')[0] || 'Administrator'
  }

  const getRoleBadge = () => {
    if (user?.role === 'super_admin') return 'Super Admin'
    if (user?.role === 'org_admin') return 'Org Admin'
    return 'User'
  }

  return (
    <header className="h-20 flex items-center justify-between px-8 fixed top-0 left-64 right-0 z-10 transition-colors bg-[#050510]/80 backdrop-blur-md border-b border-white/[0.06]">
      <div className="flex items-center space-x-6">
        <div>
          {isLoading ? (
            <div className="h-6 w-48 bg-white/[0.04] rounded animate-pulse"></div>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight text-slate-200">Hi, {getUserDisplayName()}</h1>
              <div className="flex items-center space-x-2">
                <p className="text-sm text-slate-500">{user?.role === 'super_admin' ? 'Monitoring Platform Health' : 'Monitor your endpoints'}</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-4 flex-1 max-w-md mx-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search events, agents, etc..."
            className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-white/[0.06] bg-[#0C0E1C] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/50 transition-all font-medium"
          />
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg transition-all bg-[#0A0D18] border border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.1] text-slate-400 group"
          title={`Switch to ${mounted && theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {mounted ? (
            theme === 'dark' ? (
              <Sun className="w-4 h-4 group-hover:text-emerald-400 transition-colors" />
            ) : (
              <Moon className="w-4 h-4 group-hover:text-sky-400 transition-colors" />
            )
          ) : (
            <div className="w-4 h-4" />
          )}
        </button>
        <div className="flex items-center space-x-3 pl-4 border-l border-white/[0.06]">
          <div className="text-right">
            {isLoading ? (
              <div className="space-y-1">
                <div className="h-4 w-24 bg-white/[0.04] rounded animate-pulse ml-auto"></div>
                <div className="h-3 w-16 bg-white/[0.04] rounded animate-pulse ml-auto"></div>
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-200">{getUserDisplayName()}</p>
                <p className="text-xs text-sky-400/80">{getRoleBadge()}</p>
              </>
            )}
          </div>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold bg-[#0C0E1C] border border-white/[0.08] text-slate-300">
            {isLoading ? (
              <div className="w-full h-full rounded-lg bg-white/10 animate-pulse"></div>
            ) : (
              getUserDisplayName().charAt(0).toUpperCase()
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

