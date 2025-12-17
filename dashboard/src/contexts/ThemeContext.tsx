'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize theme from document attribute (set by the script in layout.tsx)
  // This prevents flash of wrong theme on page load
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      // First check document attribute (set by blocking script)
      const docTheme = document.documentElement.getAttribute('data-theme') as Theme | null
      if (docTheme === 'light' || docTheme === 'dark') {
        return docTheme
      }
      // Fallback: try localStorage
      const storedTheme = localStorage.getItem('theme') as Theme | null
      if (storedTheme === 'light' || storedTheme === 'dark') {
        return storedTheme
      }
    }
    return 'dark'
  })

  useEffect(() => {
    // Ensure document attribute is set on mount
    const currentTheme = document.documentElement.getAttribute('data-theme') as Theme | null
    if (!currentTheme || (currentTheme !== 'light' && currentTheme !== 'dark')) {
      // If no valid theme, use state or default
      const themeToSet = theme || 'dark'
      document.documentElement.setAttribute('data-theme', themeToSet)
      if (themeToSet !== theme) {
        setTheme(themeToSet)
      }
    } else if (currentTheme !== theme) {
      // Sync state with document attribute
      setTheme(currentTheme)
    }
  }, [])

  useEffect(() => {
    // Apply theme changes to document and localStorage
    if (theme && (theme === 'light' || theme === 'dark')) {
      document.documentElement.setAttribute('data-theme', theme)
      localStorage.setItem('theme', theme)
    }
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  // Always provide the context, even before mounting
  // This prevents the "useTheme must be used within a ThemeProvider" error
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

