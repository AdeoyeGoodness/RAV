'use client'

import { useState, useEffect } from 'react'
import { Search, Sun, Moon } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

export default function Header() {
  const { theme, toggleTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Prevent hydration mismatch by only rendering theme icon after mount
  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <header className="h-20 flex items-center justify-between px-8 fixed top-0 left-64 right-0 z-10 transition-colors" style={{ backgroundColor: 'var(--bg-header)', borderBottom: '1px solid var(--border-color)' }}>
      <div className="flex items-center space-x-6">
        <div>
          <h1 className="text-xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>Hi, Administrator</h1>
          <p className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Monitor your endpoints</p>
        </div>
      </div>

      <div className="flex items-center space-x-4 flex-1 max-w-md mx-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            placeholder="Search events, agents, etc..."
            className="w-full pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:ring-2 transition-all"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'var(--accent-cyan)'
              e.target.style.boxShadow = '0 0 0 2px var(--accent-cyan)'
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'var(--border-color)'
              e.target.style.boxShadow = 'none'
            }}
          />
        </div>
      </div>

      <div className="flex items-center space-x-3">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg transition-all hover:opacity-80"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
          title={`Switch to ${mounted && theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {mounted ? (
            theme === 'dark' ? (
              <Sun className="w-5 h-5 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
            ) : (
              <Moon className="w-5 h-5 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
            )
          ) : (
            // Placeholder during SSR to prevent hydration mismatch
            <div className="w-5 h-5" />
          )}
        </button>
        <div className="text-right">
          <p className="text-sm font-medium transition-colors" style={{ color: 'var(--text-primary)' }}>Administrator</p>
          <p className="text-xs transition-colors" style={{ color: 'var(--text-tertiary)' }}>System Admin</p>
        </div>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold cyber-glow" style={{ background: 'linear-gradient(to bottom right, var(--accent-cyan), var(--accent-purple))' }}>
          A
        </div>
      </div>
    </header>
  )
}

