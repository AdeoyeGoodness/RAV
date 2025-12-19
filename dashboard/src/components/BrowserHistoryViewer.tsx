'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { Globe, Download, Search, RefreshCw, Calendar, Filter, ExternalLink, Eye } from 'lucide-react'

interface Event {
  id: string
  event_type: string
  timestamp: string
  agent_id: string
  metadata?: any
}

interface BrowserHistoryViewerProps {
  events: Event[]
  loading: boolean
  onRefresh?: () => void
  onClear?: () => void
  clearTimestamp?: Date | null
  onResetFilter?: () => void
}

export default function BrowserHistoryViewer({
  events,
  loading,
  onRefresh,
  onClear,
  clearTimestamp,
  onResetFilter
}: BrowserHistoryViewerProps) {
  const [filter, setFilter] = useState<'all' | 'history' | 'active_tab' | 'download' | 'search'>('all')
  const [browserFilter, setBrowserFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

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
      const filterDate = new Date(dateFilter)
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

  // Auto-refresh effect
  useEffect(() => {
    if (!onRefresh) return

    const interval = setInterval(() => {
      onRefresh()
    }, 10000) // Refresh every 10 seconds

    return () => clearInterval(interval)
  }, [onRefresh])

  if (browserEvents.length === 0 && !loading) {
    return (
      <div className="rounded-2xl p-6 transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>Browser History</h2>
        </div>
        <div className="text-center py-12">
          <Globe className="w-16 h-16 mx-auto mb-4 transition-colors" style={{ color: 'rgba(0, 217, 255, 0.3)' }} />
          <p className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>No browser history data available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-6 transition-colors overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>Browser History</h2>
        <div className="flex items-center space-x-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-2 rounded-lg transition-all"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--accent-cyan)'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="rounded-lg p-4 transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="flex items-center space-x-2 mb-2">
            <Eye className="w-4 h-4 transition-colors" style={{ color: '#FF9F43' }} />
            <span className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Active Tabs</span>
          </div>
          <p className="text-2xl font-bold transition-colors" style={{ color: 'var(--text-primary)' }}>{activeTabEvents.length}</p>
        </div>
        <div className="rounded-lg p-4 transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="flex items-center space-x-2 mb-2">
            <Globe className="w-4 h-4 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
            <span className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>History</span>
          </div>
          <p className="text-2xl font-bold transition-colors" style={{ color: 'var(--text-primary)' }}>{historyEvents.length}</p>
        </div>
        <div className="rounded-lg p-4 transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="flex items-center space-x-2 mb-2">
            <Download className="w-4 h-4 transition-colors" style={{ color: '#00FF88' }} />
            <span className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Downloads</span>
          </div>
          <p className="text-2xl font-bold transition-colors" style={{ color: 'var(--text-primary)' }}>{downloadEvents.length}</p>
        </div>
        <div className="rounded-lg p-4 transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="flex items-center space-x-2 mb-2">
            <Search className="w-4 h-4 transition-colors" style={{ color: '#6C5CE7' }} />
            <span className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Searches</span>
          </div>
          <p className="text-2xl font-bold transition-colors" style={{ color: 'var(--text-primary)' }}>{searchEvents.length}</p>
        </div>
        <div className="rounded-lg p-4 transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="flex items-center space-x-2 mb-2">
            <Globe className="w-4 h-4 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
            <span className="text-sm transition-colors" style={{ color: 'var(--text-tertiary)' }}>Browsers</span>
          </div>
          <p className="text-2xl font-bold transition-colors" style={{ color: 'var(--text-primary)' }}>{browsers.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)'
            }}
          >
            <option value="all">All Events</option>
            <option value="active_tab">Active Tabs</option>
            <option value="history">History</option>
            <option value="download">Downloads</option>
            <option value="search">Searches</option>
          </select>
        </div>

        {browsers.length > 0 && (
          <select
            value={browserFilter}
            onChange={(e) => setBrowserFilter(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)'
            }}
          >
            <option value="all">All Browsers</option>
            {browsers.map(browser => (
              <option key={browser} value={browser}>{browser.charAt(0).toUpperCase() + browser.slice(1)}</option>
            ))}
          </select>
        )}

        <div className="flex items-center space-x-2">
          <Calendar className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)'
            }}
          />
        </div>

        <input
          type="text"
          placeholder="Search URLs, titles, queries..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg text-sm transition-colors"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)'
          }}
        />

        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as any)}
          className="px-3 py-2 rounded-lg text-sm transition-colors"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)'
          }}
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
        </select>
      </div>

      {/* Events List */}
      <div className="space-y-3 max-h-[600px] overflow-y-auto overflow-x-hidden">
        {loading && sortedEvents.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4 transition-colors" style={{ borderColor: 'var(--accent-cyan)' }} />
            <p className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Loading browser history...</p>
          </div>
        ) : sortedEvents.length === 0 ? (
          <div className="text-center py-12">
            <p className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>No events match your filters</p>
          </div>
        ) : (
          sortedEvents.map((event) => (
            <div
              key={event.id}
              className="rounded-lg p-4 transition-colors border"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                borderColor: 'var(--border-color)'
              }}
            >
              <div className="flex items-start space-x-4">
                <div className="mt-1">
                  {getEventIcon(event.event_type)}
                </div>
                <div className="flex-1 min-w-0">
                  {/* Active Tab Events */}
                  {(event.event_type === 'browser_active_tab' || event.event_type === 'browser_tab_updated') && (
                    <>
                      <div className="flex items-center space-x-2 mb-1 overflow-hidden">
                        <a
                          href={event.metadata?.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium transition-colors hover:underline truncate block"
                          style={{ color: '#FF9F43' }}
                        >
                          {event.metadata?.title || formatUrl(event.metadata?.url || '')}
                        </a>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                      </div>
                      <p className="text-sm truncate transition-colors break-all" style={{ color: 'var(--text-tertiary)' }}>
                        {event.metadata?.url}
                      </p>
                      <div className="flex items-center flex-wrap gap-2 mt-2 text-xs transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255, 159, 67, 0.2)', color: '#FF9F43' }}>
                          {event.event_type === 'browser_active_tab' ? 'TAB ACTIVATED' : 'TAB UPDATED'}
                        </span>
                        {event.metadata?.incognito && (
                          <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(108, 92, 231, 0.2)', color: '#6C5CE7' }}>
                            INCOGNITO
                          </span>
                        )}
                        <span className="whitespace-nowrap" style={{ color: getBrowserColor(event.metadata?.browser) }}>
                          {(event.metadata?.browser || 'unknown').toUpperCase()}
                        </span>
                        <span className="whitespace-nowrap">{format(new Date(event.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    </>
                  )}

                  {/* History Visit Events */}
                  {(event.event_type === 'browser_history_visited' || event.event_type === 'browser_history_visit') && (
                    <>
                      <div className="flex items-center space-x-2 mb-1 overflow-hidden">
                        <a
                          href={event.metadata?.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium transition-colors hover:underline truncate block"
                          style={{ color: 'var(--accent-cyan)' }}
                        >
                          {event.metadata?.title || formatUrl(event.metadata?.url || '')}
                        </a>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                      </div>
                      <p className="text-sm truncate transition-colors break-all" style={{ color: 'var(--text-tertiary)' }}>
                        {event.metadata?.url}
                      </p>
                      <div className="flex items-center flex-wrap gap-2 mt-2 text-xs transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="whitespace-nowrap">Visits: {event.metadata?.visit_count || 0}</span>
                        <span className="whitespace-nowrap" style={{ color: getBrowserColor(event.metadata?.browser_type || event.metadata?.browser) }}>
                          {(event.metadata?.browser_type || event.metadata?.browser || 'unknown').toUpperCase()}
                        </span>
                        <span className="whitespace-nowrap">{format(new Date(event.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    </>
                  )}

                  {/* Download Events */}
                  {event.event_type.includes('download') && (
                    <>
                      <div className="flex items-center space-x-2 mb-1 overflow-hidden">
                        <span className="font-medium transition-colors truncate" style={{ color: 'var(--text-primary)' }}>
                          {event.metadata?.file_name || event.metadata?.filename || 'Unknown File'}
                        </span>
                        {event.event_type === 'browser_download_completed' && (
                          <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: 'rgba(0, 255, 136, 0.2)', color: '#00FF88' }}>
                            COMPLETED
                          </span>
                        )}
                        {event.event_type === 'browser_download_failed' && (
                          <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: 'rgba(255, 107, 107, 0.2)', color: '#FF6B6B' }}>
                            FAILED
                          </span>
                        )}
                        {event.event_type === 'browser_download_started' && (
                          <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: 'rgba(0, 217, 255, 0.2)', color: 'var(--accent-cyan)' }}>
                            STARTED
                          </span>
                        )}
                      </div>
                      <p className="text-sm transition-colors truncate break-all" style={{ color: 'var(--text-tertiary)' }}>
                        {event.metadata?.source_url || event.metadata?.target_path || event.metadata?.current_path || 'Unknown path'}
                      </p>
                      <div className="flex items-center flex-wrap gap-2 mt-2 text-xs transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="whitespace-nowrap">
                          {event.metadata?.file_size
                            ? `${(event.metadata.file_size / 1024 / 1024).toFixed(2)} MB`
                            : event.metadata?.received_bytes
                              ? `${(event.metadata.received_bytes / 1024 / 1024).toFixed(2)} MB`
                              : 'Size unknown'}
                        </span>
                        <span className="whitespace-nowrap" style={{ color: getBrowserColor(event.metadata?.browser_type || event.metadata?.browser) }}>
                          {(event.metadata?.browser_type || event.metadata?.browser || 'unknown').toUpperCase()}
                        </span>
                        <span className="whitespace-nowrap">{format(new Date(event.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    </>
                  )}

                  {event.event_type === 'browser_search_query' && (
                    <>
                      <div className="flex items-center space-x-2 mb-1 overflow-hidden">
                        <span className="font-medium transition-colors truncate" style={{ color: 'var(--text-primary)' }}>
                          "{event.metadata?.query || 'Unknown query'}"
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: 'rgba(108, 92, 231, 0.2)', color: '#6C5CE7' }}>
                          {(event.metadata?.search_engine || 'search').toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm transition-colors truncate break-all" style={{ color: 'var(--text-tertiary)' }}>
                        {event.metadata?.url}
                      </p>
                      <div className="flex items-center flex-wrap gap-2 mt-2 text-xs transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="whitespace-nowrap" style={{ color: getBrowserColor(event.metadata?.browser_type || event.metadata?.browser) }}>
                          {(event.metadata?.browser_type || event.metadata?.browser || 'unknown').toUpperCase()}
                        </span>
                        <span className="whitespace-nowrap">{format(new Date(event.timestamp), 'MMM dd, yyyy HH:mm:ss')}</span>
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

