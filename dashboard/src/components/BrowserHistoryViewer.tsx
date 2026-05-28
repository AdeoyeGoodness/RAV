'use client'

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { Globe, Download, Search, RefreshCw, Calendar, Filter, ExternalLink, Eye } from 'lucide-react'
import { getEvents } from '@/lib/api'

interface Event {
  id: string
  event_type: string
  timestamp: string
  agent_id: string
  metadata?: any
}

interface BrowserHistoryViewerProps {
  agentId: string
  onClear?: () => void
  clearTimestamp?: Date | null
  onResetFilter?: () => void
}

export default function BrowserHistoryViewer({
  agentId,
  onClear,
  clearTimestamp,
  onResetFilter
}: BrowserHistoryViewerProps) {
  const [filter, setFilter] = useState<'all' | 'history' | 'active_tab' | 'download' | 'search'>('all')
  const [browserFilter, setBrowserFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // This section owns its own data, so refreshing it never touches the others.
  const fetchEvents = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      // When a date is picked, filter on the SERVER by that local day's UTC
      // bounds + category. A recent-N client-side filter never reaches older
      // days on busy agents. Browser events are categorized as "browser".
      const params: any = { agent_id: agentId, limit: 1000 }
      if (dateFilter) {
        params.category = 'browser'
        params.start_time = new Date(`${dateFilter}T00:00:00`).toISOString()
        params.end_time = new Date(`${dateFilter}T23:59:59.999`).toISOString()
      }
      const data = await getEvents(params)
      setAllEvents(data as Event[])
    } catch (e) {
      console.error('Failed to load browser events:', e)
    } finally {
      if (!background) setLoading(false)
    }
  }, [agentId, dateFilter])

  // Initial load shows a spinner; auto-refresh updates live without one.
  useEffect(() => { fetchEvents(false) }, [fetchEvents])
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => fetchEvents(true), 10000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchEvents])

  // Apply the global "Clear" timestamp to this section's own data
  const events = clearTimestamp
    ? allEvents.filter(e => new Date(e.timestamp) > clearTimestamp)
    : allEvents

  // Filter browser events - Support both old and new event types
  const browserEvents = events.filter(e =>
    e.event_type === 'browser_history_visited' ||
    e.event_type === 'browser_history_visit' ||
    e.event_type === 'browser_active_tab' ||
    e.event_type === 'browser_tab_updated' ||
    e.event_type === 'browser_download' ||
    e.event_type === 'browser_download_started' ||
    e.event_type === 'browser_download_completed' ||
    e.event_type === 'browser_download_failed' ||
    e.event_type === 'browser_search_query'
  )

  // Get unique browsers
  const browsers = Array.from(new Set(
    browserEvents
      .map(e => e.metadata?.browser_type)
      .filter(Boolean)
  ))

  // Apply date filter
  const dateFilteredEvents = dateFilter
    ? browserEvents.filter(e => {
      const eventDate = new Date(e.timestamp)
      // Parse the picked day in LOCAL time (new Date('YYYY-MM-DD') is UTC
      // midnight and shifts a day in negative-UTC zones).
      const filterDate = new Date(`${dateFilter}T00:00:00`)
      return eventDate.toDateString() === filterDate.toDateString()
    })
    : browserEvents

  // Apply browser filter
  const browserFilteredEvents = browserFilter === 'all'
    ? dateFilteredEvents
    : dateFilteredEvents.filter(e => e.metadata?.browser_type === browserFilter)

  // Apply type filter
  const typeFilteredEvents = filter === 'all'
    ? browserFilteredEvents
    : browserFilteredEvents.filter(e => {
      switch (filter) {
        case 'history':
          return e.event_type === 'browser_history_visited' || e.event_type === 'browser_history_visit'
        case 'active_tab':
          return e.event_type === 'browser_active_tab' || e.event_type === 'browser_tab_updated'
        case 'download':
          return e.event_type.includes('download')
        case 'search':
          return e.event_type === 'browser_search_query'
        default:
          return true
      }
    })

  // Apply search filter
  const searchFilteredEvents = searchQuery
    ? typeFilteredEvents.filter(e => {
      const url = e.metadata?.url || ''
      const title = e.metadata?.title || ''
      const query = e.metadata?.query || ''
      const searchLower = searchQuery.toLowerCase()
      return url.toLowerCase().includes(searchLower) ||
        title.toLowerCase().includes(searchLower) ||
        query.toLowerCase().includes(searchLower)
    })
    : typeFilteredEvents

  // Helper helper to sanitize URLs
  const getSafeUrl = (url?: string) => {
    if (!url) return '#'
    try {
      const parsed = new URL(url)
      // Only allow http and https protocols
      if (['http:', 'https:'].includes(parsed.protocol)) {
        return url
      }
    } catch (e) {
      // If valid URL parsing fails, check simple startswith for relative or basic absolute
      if (url.startsWith('/') || url.startsWith('http:') || url.startsWith('https:')) {
        return url
      }
    }
    return '#'
  }

  // Sort events
  const sortedEvents = [...searchFilteredEvents].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime()
    const timeB = new Date(b.timestamp).getTime()
    return sortOrder === 'newest' ? timeB - timeA : timeA - timeB
  })

  // Group events by type
  const historyEvents = browserEvents.filter(e => e.event_type === 'browser_history_visited' || e.event_type === 'browser_history_visit')
  const activeTabEvents = browserEvents.filter(e => e.event_type === 'browser_active_tab' || e.event_type === 'browser_tab_updated')
  const downloadEvents = browserEvents.filter(e => e.event_type.includes('download'))
  const searchEvents = browserEvents.filter(e => e.event_type === 'browser_search_query')

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'browser_history_visited':
      case 'browser_history_visit':
        return <Globe className="w-5 h-5 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
      case 'browser_active_tab':
      case 'browser_tab_updated':
        return <Eye className="w-5 h-5 transition-colors" style={{ color: '#FF9F43' }} />
      case 'browser_download':
      case 'browser_download_started':
      case 'browser_download_completed':
      case 'browser_download_failed':
        return <Download className="w-5 h-5 transition-colors" style={{ color: '#00FF88' }} />
      case 'browser_search_query':
        return <Search className="w-5 h-5 transition-colors" style={{ color: '#6C5CE7' }} />
      default:
        return <Globe className="w-5 h-5 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
    }
  }

  const getBrowserColor = (browserType: string) => {
    switch (browserType?.toLowerCase()) {
      case 'chrome':
        return '#4285F4'
      case 'edge':
        return '#0078D4'
      case 'firefox':
        return '#FF7139'
      case 'safari':
        return '#000000'
      default:
        return 'var(--accent-cyan)'
    }
  }

  const formatUrl = (url: string) => {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname
    } catch {
      return url
    }
  }

  return (
    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl p-7 shadow-xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 pb-6 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
            <Globe className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Browser Forensics</h2>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border ${
              autoRefresh
                ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                : 'bg-black/40 text-slate-500 border-white/5 hover:text-slate-300'
            }`}
          >
            Auto: {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => fetchEvents(false)}
            className="p-2 rounded-lg bg-black/40 border border-white/5 text-indigo-400 hover:bg-indigo-500/10 hover:border-indigo-500/30 transition-all disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-300' : ''}`} />
          </button>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
          <div className="flex items-center space-x-3 mb-3">
            <div className="p-2 rounded-lg bg-orange-500/10 text-orange-400 group-hover:scale-110 transition-transform">
              <Eye className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Tabs</span>
          </div>
          <p className="text-3xl font-light text-white font-mono">{activeTabEvents.length}</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
          <div className="flex items-center space-x-3 mb-3">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:scale-110 transition-transform">
              <Globe className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">History</span>
          </div>
          <p className="text-3xl font-light text-white font-mono">{historyEvents.length}</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
          <div className="flex items-center space-x-3 mb-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
              <Download className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Downloads</span>
          </div>
          <p className="text-3xl font-light text-white font-mono">{downloadEvents.length}</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
          <div className="flex items-center space-x-3 mb-3">
            <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400 group-hover:scale-110 transition-transform">
              <Search className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Searches</span>
          </div>
          <p className="text-3xl font-light text-white font-mono">{searchEvents.length}</p>
        </div>
        <div className="rounded-xl p-4 bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all group">
          <div className="flex items-center space-x-3 mb-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 group-hover:scale-110 transition-transform">
              <Globe className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Browsers</span>
          </div>
          <p className="text-3xl font-light text-white font-mono">{browsers.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-8 bg-black/20 p-2 rounded-xl border border-white/5">
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 focus-within:border-indigo-500/30 transition-colors">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="bg-transparent border-none text-sm text-slate-300 focus:outline-none cursor-pointer"
          >
            <option value="all" className="bg-slate-900">All Events</option>
            <option value="active_tab" className="bg-slate-900">Active Tabs</option>
            <option value="history" className="bg-slate-900">History</option>
            <option value="download" className="bg-slate-900">Downloads</option>
            <option value="search" className="bg-slate-900">Searches</option>
          </select>
        </div>

        {browsers.length > 0 && (
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 focus-within:border-indigo-500/30 transition-colors">
            <Globe className="w-4 h-4 text-slate-400" />
            <select
              value={browserFilter}
              onChange={(e) => setBrowserFilter(e.target.value)}
              className="bg-transparent border-none text-sm text-slate-300 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900">All Browsers</option>
              {browsers.map(browser => (
                <option key={browser} value={browser} className="bg-slate-900">{browser.charAt(0).toUpperCase() + browser.slice(1)}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 focus-within:border-indigo-500/30 transition-colors">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="bg-transparent border-none text-sm text-slate-300 focus:outline-none"
            style={{ colorScheme: 'dark' }}
          />
        </div>

        <div className="flex-1 min-w-[200px] flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 focus-within:border-indigo-500/50 focus-within:shadow-[0_0_15px_rgba(99,102,241,0.15)] transition-all">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search URLs, titles, queries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none text-sm text-white placeholder:text-slate-500 focus:outline-none w-full"
          />
        </div>

        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 focus-within:border-indigo-500/30 transition-colors">
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as any)}
            className="bg-transparent border-none text-sm text-slate-300 focus:outline-none cursor-pointer"
          >
            <option value="newest" className="bg-slate-900">Newest First</option>
            <option value="oldest" className="bg-slate-900">Oldest First</option>
          </select>
        </div>
      </div>

      {/* Events List */}
      <div className="space-y-4 max-h-[600px] overflow-y-auto overflow-x-hidden custom-scrollbar pr-2">
        {loading && sortedEvents.length === 0 ? (
          <div className="text-center py-16 bg-black/20 rounded-xl border border-white/5">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-slate-500" />
            <p className="text-slate-400 font-medium">Loading browser forensics...</p>
          </div>
        ) : sortedEvents.length === 0 ? (
          <div className="text-center py-16 bg-black/20 rounded-xl border border-dashed border-white/10">
            <Globe className="w-16 h-16 mx-auto mb-4 text-slate-600" />
            <p className="text-lg font-bold mb-2 text-slate-300">No events match your filters</p>
          </div>
        ) : (
          sortedEvents.map((event) => (
            <div
              key={event.id}
              className="rounded-xl p-5 transition-all border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-indigo-500/30 group"
            >
              <div className="flex items-start space-x-4">
                <div className="p-2.5 rounded-lg bg-black/40 mt-0.5 border border-white/5 group-hover:border-indigo-500/20 transition-colors">
                  {getEventIcon(event.event_type)}
                </div>
                <div className="flex-1 min-w-0">
                  {/* Active Tab Events */}
                  {(event.event_type === 'browser_active_tab' || event.event_type === 'browser_tab_updated') && (
                    <>
                      <div className="flex items-center space-x-2 mb-1 overflow-hidden">
                        <a
                          href={getSafeUrl(event.metadata?.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-orange-400 hover:text-orange-300 hover:underline truncate block"
                        >
                          {event.metadata?.title || formatUrl(event.metadata?.url || '')}
                        </a>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 text-slate-500 group-hover:text-orange-400/50 transition-colors" />
                      </div>
                      <p className="text-sm truncate text-slate-400 break-all">
                        {event.metadata?.url}
                      </p>
                      <div className="flex items-center flex-wrap gap-2 mt-3 text-[10px] font-mono text-slate-500">
                        <span className="px-2 py-1 rounded bg-orange-500/10 text-orange-400 font-bold uppercase tracking-wider">
                          {event.event_type === 'browser_active_tab' ? 'TAB ACTIVATED' : 'TAB UPDATED'}
                        </span>
                        {event.metadata?.incognito && (
                          <span className="px-2 py-1 rounded bg-violet-500/10 text-violet-400 font-bold uppercase tracking-wider">
                            INCOGNITO
                          </span>
                        )}
                        <span className="px-2 py-1 rounded bg-black/50 text-white uppercase" style={{ color: getBrowserColor(event.metadata?.browser) }}>
                          {(event.metadata?.browser || 'unknown').toUpperCase()}
                        </span>
                        <span className="px-2 py-1 rounded bg-black/50 text-slate-400">{format(new Date(event.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    </>
                  )}

                  {/* History Visit Events */}
                  {(event.event_type === 'browser_history_visited' || event.event_type === 'browser_history_visit') && (
                    <>
                      <div className="flex items-center space-x-2 mb-1 overflow-hidden">
                        <a
                          href={getSafeUrl(event.metadata?.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-cyan-400 hover:text-cyan-300 hover:underline truncate block"
                        >
                          {event.metadata?.title || formatUrl(event.metadata?.url || '')}
                        </a>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 text-slate-500 group-hover:text-cyan-400/50 transition-colors" />
                      </div>
                      <p className="text-sm truncate text-slate-400 break-all">
                        {event.metadata?.url}
                      </p>
                      <div className="flex items-center flex-wrap gap-2 mt-3 text-[10px] font-mono text-slate-500">
                        <span className="px-2 py-1 rounded bg-white/5 text-slate-300">VISITS: {event.metadata?.visit_count || 0}</span>
                        <span className="px-2 py-1 rounded bg-black/50 uppercase" style={{ color: getBrowserColor(event.metadata?.browser_type || event.metadata?.browser) }}>
                          {(event.metadata?.browser_type || event.metadata?.browser || 'unknown').toUpperCase()}
                        </span>
                        <span className="px-2 py-1 rounded bg-black/50 text-slate-400">{format(new Date(event.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    </>
                  )}

                  {/* Download Events */}
                  {event.event_type.includes('download') && (
                    <>
                      <div className="flex items-center space-x-3 mb-1 overflow-hidden">
                        <span className="font-bold text-white truncate">
                          {event.metadata?.file_name || event.metadata?.filename || 'Unknown File'}
                        </span>
                        {event.event_type === 'browser_download_completed' && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold text-[10px] uppercase tracking-wider">
                            COMPLETED
                          </span>
                        )}
                        {event.event_type === 'browser_download_failed' && (
                          <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 font-bold text-[10px] uppercase tracking-wider">
                            FAILED
                          </span>
                        )}
                        {event.event_type === 'browser_download_started' && (
                          <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-bold text-[10px] uppercase tracking-wider">
                            STARTED
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-400 truncate break-all">
                        {event.metadata?.source_url || event.metadata?.target_path || event.metadata?.current_path || 'Unknown path'}
                      </p>
                      <div className="flex items-center flex-wrap gap-2 mt-3 text-[10px] font-mono text-slate-500">
                        <span className="px-2 py-1 rounded bg-white/5 text-emerald-400 font-medium">
                          {event.metadata?.file_size
                            ? `${(event.metadata.file_size / 1024 / 1024).toFixed(2)} MB`
                            : event.metadata?.received_bytes
                              ? `${(event.metadata.received_bytes / 1024 / 1024).toFixed(2)} MB`
                              : 'Size unknown'}
                        </span>
                        <span className="px-2 py-1 rounded bg-black/50 uppercase" style={{ color: getBrowserColor(event.metadata?.browser_type || event.metadata?.browser) }}>
                          {(event.metadata?.browser_type || event.metadata?.browser || 'unknown').toUpperCase()}
                        </span>
                        <span className="px-2 py-1 rounded bg-black/50 text-slate-400">{format(new Date(event.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    </>
                  )}

                  {event.event_type === 'browser_search_query' && (
                    <>
                      <div className="flex items-center space-x-3 mb-1 overflow-hidden">
                        <span className="font-bold text-white text-lg tracking-tight truncate">
                          "{event.metadata?.query || 'Unknown query'}"
                        </span>
                        <span className="px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 font-bold text-[10px] uppercase tracking-wider">
                          {(event.metadata?.search_engine || 'search').toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-slate-400 truncate break-all">
                        {event.metadata?.url}
                      </p>
                      <div className="flex items-center flex-wrap gap-2 mt-3 text-[10px] font-mono text-slate-500">
                        <span className="px-2 py-1 rounded bg-black/50 uppercase" style={{ color: getBrowserColor(event.metadata?.browser_type || event.metadata?.browser) }}>
                          {(event.metadata?.browser_type || event.metadata?.browser || 'unknown').toUpperCase()}
                        </span>
                        <span className="px-2 py-1 rounded bg-black/50 text-slate-400">{format(new Date(event.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

