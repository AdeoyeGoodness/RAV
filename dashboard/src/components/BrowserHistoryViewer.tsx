'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatWATPattern } from '@/lib/time'
import { Globe, Download, Search, RefreshCw, Calendar, Filter, ExternalLink, Eye } from 'lucide-react'
import { getEvents } from '@/lib/api'
import { Panel, PanelHead, Eyebrow, Stat, StatusPill } from '@/components/ct/primitives'

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

  const fetchEvents = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
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

  useEffect(() => { fetchEvents(false) }, [fetchEvents])
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => fetchEvents(true), 10000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchEvents])

  const events = clearTimestamp
    ? allEvents.filter(e => new Date(e.timestamp) > clearTimestamp)
    : allEvents

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

  const browsers = Array.from(new Set(
    browserEvents
      .map(e => e.metadata?.browser_type)
      .filter(Boolean)
  ))

  const dateFilteredEvents = dateFilter
    ? browserEvents.filter(e => {
      const eventDate = new Date(e.timestamp)
      const filterDate = new Date(`${dateFilter}T00:00:00`)
      return eventDate.toDateString() === filterDate.toDateString()
    })
    : browserEvents

  const browserFilteredEvents = browserFilter === 'all'
    ? dateFilteredEvents
    : dateFilteredEvents.filter(e => e.metadata?.browser_type === browserFilter)

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

  // Dedupe consecutive same-URL events fired within a short window. Chrome
  // and Edge extensions frequently double-fire on the same navigation
  // (activation + tab_updated + history_visit for one page load) which was
  // the source of the "duplicate data on pages" pain. We collapse by
  // (event_type, browser, url, minute-bucket) and count how many collapsed
  // into each survivor.
  interface DisplayEvent extends Event {
    _dupCount?: number
  }
  const dedupeWindowMs = 60_000
  const dedupedEvents: DisplayEvent[] = (() => {
    // Sort by timestamp ascending so we always keep the earliest and count later dupes into it.
    const chrono = [...searchFilteredEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    const survivors: DisplayEvent[] = []
    const keyFor = (e: Event) =>
      `${e.event_type}|${e.metadata?.browser || e.metadata?.browser_type || ''}|${e.metadata?.url || e.metadata?.query || ''}`
    const lastByKey = new Map<string, DisplayEvent>()
    for (const ev of chrono) {
      const k = keyFor(ev)
      const prev = lastByKey.get(k)
      if (prev) {
        const dt = new Date(ev.timestamp).getTime() - new Date(prev.timestamp).getTime()
        if (Math.abs(dt) <= dedupeWindowMs) {
          prev._dupCount = (prev._dupCount || 1) + 1
          continue
        }
      }
      const cloned: DisplayEvent = { ...ev }
      survivors.push(cloned)
      lastByKey.set(k, cloned)
    }
    return survivors
  })()

  const getSafeUrl = (url?: string) => {
    if (!url) return '#'
    try {
      const parsed = new URL(url)
      if (['http:', 'https:'].includes(parsed.protocol)) {
        return url
      }
    } catch (e) {
      if (url.startsWith('/') || url.startsWith('http:') || url.startsWith('https:')) {
        return url
      }
    }
    return '#'
  }

  const sortedEvents = [...dedupedEvents].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime()
    const timeB = new Date(b.timestamp).getTime()
    return sortOrder === 'newest' ? timeB - timeA : timeA - timeB
  })
  const suppressedCount = searchFilteredEvents.length - dedupedEvents.length

  const historyEvents = browserEvents.filter(e => e.event_type === 'browser_history_visited' || e.event_type === 'browser_history_visit')
  const activeTabEvents = browserEvents.filter(e => e.event_type === 'browser_active_tab' || e.event_type === 'browser_tab_updated')
  const downloadEvents = browserEvents.filter(e => e.event_type.includes('download'))
  const searchEvents = browserEvents.filter(e => e.event_type === 'browser_search_query')

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'browser_history_visited':
      case 'browser_history_visit':
        return <Globe className="w-4 h-4 text-ct-accent" />
      case 'browser_active_tab':
      case 'browser_tab_updated':
        return <Eye className="w-4 h-4 text-ct-warn" />
      case 'browser_download':
      case 'browser_download_started':
      case 'browser_download_completed':
      case 'browser_download_failed':
        return <Download className="w-4 h-4 text-ct-ok" />
      case 'browser_search_query':
        return <Search className="w-4 h-4 text-ct-accent" />
      default:
        return <Globe className="w-4 h-4 text-ct-accent" />
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

  const selectBase = 'bg-transparent border-none text-[12px] text-ct-ink2 font-mono focus:outline-none cursor-pointer'

  return (
    <Panel>
      <PanelHead
        title={
          <span className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-ct-accent" />
            Browser Forensics
          </span>
        }
        live={autoRefresh}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className="font-mono text-[10px] uppercase px-2 py-1 rounded-sm border transition-colors"
              style={{
                color: autoRefresh ? 'var(--ct-accent)' : 'var(--ct-ink3)',
                borderColor: autoRefresh ? 'var(--ct-accent-border)' : 'var(--ct-line2)',
                background: autoRefresh ? 'var(--ct-accent-soft)' : 'transparent',
                letterSpacing: '0.18em',
              }}
            >
              Auto {autoRefresh ? 'On' : 'Off'}
            </button>
            <button
              onClick={() => fetchEvents(false)}
              className="p-1.5 rounded-sm border border-ct-line text-ct-accent hover:bg-ct-panel-hi hover:border-ct-accent-border transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      <div className="p-6 space-y-5">
        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-5 border border-ct-line rounded-sm overflow-hidden">
          <Stat label="Active Tabs" value={activeTabEvents.length} tone="warn" />
          <Stat label="History" value={historyEvents.length} tone="accent" />
          <Stat label="Downloads" value={downloadEvents.length} tone="ok" />
          <Stat label="Searches" value={searchEvents.length} tone="accent" />
          <Stat label="Browsers" value={browsers.length} tone="accent" last />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-sm bg-ct-bg2 border border-ct-line">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-ct-bg border border-ct-line">
            <Filter className="w-3.5 h-3.5 text-ct-ink3" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className={selectBase}
            >
              <option value="all">All Events</option>
              <option value="active_tab">Active Tabs</option>
              <option value="history">History</option>
              <option value="download">Downloads</option>
              <option value="search">Searches</option>
            </select>
          </div>

          {browsers.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-ct-bg border border-ct-line">
              <Globe className="w-3.5 h-3.5 text-ct-ink3" />
              <select
                value={browserFilter}
                onChange={(e) => setBrowserFilter(e.target.value)}
                className={selectBase}
              >
                <option value="all">All Browsers</option>
                {browsers.map(browser => (
                  <option key={browser} value={browser}>{browser.charAt(0).toUpperCase() + browser.slice(1)}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-ct-bg border border-ct-line">
            <Calendar className="w-3.5 h-3.5 text-ct-ink3" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent border-none text-[12px] text-ct-ink2 font-mono focus:outline-none"
              style={{ colorScheme: 'dark' }}
            />
          </div>

          <div className="flex-1 min-w-[200px] flex items-center gap-2 px-3 py-1.5 rounded-sm bg-ct-bg border border-ct-line">
            <Search className="w-3.5 h-3.5 text-ct-ink3" />
            <input
              type="text"
              placeholder="Search URLs, titles, queries…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none text-[12px] text-ct-ink font-mono placeholder:text-ct-ink4 focus:outline-none w-full"
            />
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-ct-bg border border-ct-line">
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className={selectBase}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
        </div>

        {/* Events List */}
        <div className="space-y-3 max-h-[600px] overflow-y-auto overflow-x-hidden pr-1">
          {loading && sortedEvents.length === 0 ? (
            <div className="text-center py-16 rounded-sm border border-ct-line bg-ct-bg2">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-ct-ink3" />
              <p className="text-[12px] text-ct-ink3 font-mono uppercase" style={{ letterSpacing: '0.18em' }}>Loading forensics</p>
            </div>
          ) : sortedEvents.length === 0 && browserEvents.length === 0 ? (
            // Zero browser events at all — the extension probably isn't on
            // this endpoint. Direct the operator to the deployment doc
            // instead of showing a generic empty state.
            <div className="text-center py-14 rounded-sm border border-dashed border-ct-line bg-ct-bg2">
              <Globe className="w-10 h-10 mx-auto mb-3 text-ct-ink4" />
              <p className="text-[13px] font-medium text-ct-ink2">Browser extension not detected</p>
              <p className="text-[11px] text-ct-ink3 mt-2 max-w-md mx-auto font-mono" style={{ letterSpacing: '0.04em' }}>
                No browser events have arrived from this endpoint. Install the
                RAV browser extension (force-installed via Edge / Chrome store
                policy) to capture history, active tabs, downloads, and
                searches.
              </p>
            </div>
          ) : sortedEvents.length === 0 ? (
            <div className="text-center py-16 rounded-sm border border-dashed border-ct-line bg-ct-bg2">
              <Globe className="w-10 h-10 mx-auto mb-3 text-ct-ink4" />
              <p className="text-[13px] font-medium text-ct-ink2">No events match your filters</p>
            </div>
          ) : (
            <>
              {suppressedCount > 0 && (
                <div
                  className="rounded-sm px-4 py-2 text-[11px] font-mono text-ct-ink3"
                  style={{ background: 'var(--ct-bg2)', border: '1px solid var(--ct-line)', letterSpacing: '0.06em' }}
                >
                  {suppressedCount.toLocaleString()} duplicate{suppressedCount === 1 ? '' : 's'} suppressed
                  (same URL fired within 60 s window) — expand any entry to see original count.
                </div>
              )}
            {sortedEvents.map((event) => (
              <div
                key={event.id}
                className="rounded-sm p-4 transition-colors border border-ct-line bg-ct-bg2 hover:bg-ct-panel-hi"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-sm border border-ct-line bg-ct-bg">
                    {getEventIcon(event.event_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    {(event as any)._dupCount && (event as any)._dupCount > 1 && (
                      <StatusPill tone="idle" dot={false}>
                        &times;{(event as any)._dupCount}
                      </StatusPill>
                    )}
                    {/* Active Tab Events */}
                    {(event.event_type === 'browser_active_tab' || event.event_type === 'browser_tab_updated') && (
                      <>
                        <div className="flex items-center gap-2 mb-1 overflow-hidden">
                          <a
                            href={getSafeUrl(event.metadata?.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[13px] font-semibold text-ct-warn hover:brightness-125 truncate block"
                          >
                            {event.metadata?.title || formatUrl(event.metadata?.url || '')}
                          </a>
                          <ExternalLink className="w-3 h-3 flex-shrink-0 text-ct-ink3" />
                        </div>
                        <p className="text-[12px] truncate text-ct-ink3 font-mono break-all">{event.metadata?.url}</p>
                        <div className="flex items-center flex-wrap gap-2 mt-3">
                          <StatusPill tone="warn" dot={false}>
                            {event.event_type === 'browser_active_tab' ? 'Tab Activated' : 'Tab Updated'}
                          </StatusPill>
                          {event.metadata?.incognito && (
                            <StatusPill tone="accent" dot={false}>Incognito</StatusPill>
                          )}
                          <StatusPill tone="idle" dot={false}>
                            {(event.metadata?.browser || 'unknown').toUpperCase()}
                          </StatusPill>
                          <span className="font-mono text-[10px] text-ct-ink3 tabular-nums">{formatWATPattern(event.timestamp, 'MMM dd, yyyy HH:mm:ss')}</span>
                        </div>
                      </>
                    )}

                    {/* History Visit Events */}
                    {(event.event_type === 'browser_history_visited' || event.event_type === 'browser_history_visit') && (
                      <>
                        <div className="flex items-center gap-2 mb-1 overflow-hidden">
                          <a
                            href={getSafeUrl(event.metadata?.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[13px] font-semibold text-ct-accent hover:brightness-125 truncate block"
                          >
                            {event.metadata?.title || formatUrl(event.metadata?.url || '')}
                          </a>
                          <ExternalLink className="w-3 h-3 flex-shrink-0 text-ct-ink3" />
                        </div>
                        <p className="text-[12px] truncate text-ct-ink3 font-mono break-all">{event.metadata?.url}</p>
                        <div className="flex items-center flex-wrap gap-2 mt-3">
                          <StatusPill tone="idle" dot={false}>Visits {event.metadata?.visit_count || 0}</StatusPill>
                          <StatusPill tone="idle" dot={false}>
                            {(event.metadata?.browser_type || event.metadata?.browser || 'unknown').toUpperCase()}
                          </StatusPill>
                          <span className="font-mono text-[10px] text-ct-ink3 tabular-nums">{formatWATPattern(event.timestamp, 'MMM dd, yyyy HH:mm:ss')}</span>
                        </div>
                      </>
                    )}

                    {/* Download Events */}
                    {event.event_type.includes('download') && (
                      <>
                        <div className="flex items-center gap-2 mb-1 overflow-hidden">
                          <span className="text-[13px] font-semibold text-ct-ink truncate">
                            {event.metadata?.file_name || event.metadata?.filename || 'Unknown File'}
                          </span>
                          {event.event_type === 'browser_download_completed' && <StatusPill tone="ok" dot={false}>Completed</StatusPill>}
                          {event.event_type === 'browser_download_failed' && <StatusPill tone="crit" dot={false}>Failed</StatusPill>}
                          {event.event_type === 'browser_download_started' && <StatusPill tone="accent" dot={false}>Started</StatusPill>}
                        </div>
                        <p className="text-[12px] text-ct-ink3 truncate font-mono break-all">
                          {event.metadata?.source_url || event.metadata?.target_path || event.metadata?.current_path || 'Unknown path'}
                        </p>
                        <div className="flex items-center flex-wrap gap-2 mt-3">
                          <StatusPill tone="ok" dot={false}>
                            {event.metadata?.file_size
                              ? `${(event.metadata.file_size / 1024 / 1024).toFixed(2)} MB`
                              : event.metadata?.received_bytes
                                ? `${(event.metadata.received_bytes / 1024 / 1024).toFixed(2)} MB`
                                : 'Size unknown'}
                          </StatusPill>
                          <StatusPill tone="idle" dot={false}>
                            {(event.metadata?.browser_type || event.metadata?.browser || 'unknown').toUpperCase()}
                          </StatusPill>
                          <span className="font-mono text-[10px] text-ct-ink3 tabular-nums">{formatWATPattern(event.timestamp, 'MMM dd, yyyy HH:mm:ss')}</span>
                        </div>
                      </>
                    )}

                    {event.event_type === 'browser_search_query' && (
                      <>
                        <div className="flex items-center gap-2 mb-1 overflow-hidden">
                          <span className="text-[14px] font-semibold text-ct-ink truncate">
                            &ldquo;{event.metadata?.query || 'Unknown query'}&rdquo;
                          </span>
                          <StatusPill tone="accent" dot={false}>{(event.metadata?.search_engine || 'search').toUpperCase()}</StatusPill>
                        </div>
                        <p className="text-[12px] text-ct-ink3 truncate font-mono break-all">{event.metadata?.url}</p>
                        <div className="flex items-center flex-wrap gap-2 mt-3">
                          <StatusPill tone="idle" dot={false}>
                            {(event.metadata?.browser_type || event.metadata?.browser || 'unknown').toUpperCase()}
                          </StatusPill>
                          <span className="font-mono text-[10px] text-ct-ink3 tabular-nums">{formatWATPattern(event.timestamp, 'MMM dd, yyyy HH:mm:ss')}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            </>
          )}
        </div>
      </div>
    </Panel>
  )
}
