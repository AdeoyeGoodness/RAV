'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { formatWATTime } from '@/lib/time'
import { RefreshCw, Download, Upload, Usb, X, Eye, Trash2, Calendar, Clock } from 'lucide-react'
import { getEvents } from '@/lib/api'
import { Panel, PanelHead, Chip, StatusPill } from '@/components/ct/primitives'

interface Event {
  id: string
  event_type: string
  timestamp: string
  agent_id: string
  metadata?: any
}

interface USBMonitoringProps {
  agentId: string
  onClear?: () => void
  clearTimestamp?: Date | null
  onResetFilter?: () => void
}

export default function USBMonitoring({ agentId, onClear, clearTimestamp, onResetFilter }: USBMonitoringProps) {
  const [filter, setFilter] = useState<'all' | 'usb_inserted' | 'usb_removed' | 'usb_file_transfer'>('all')
  const [dateFilter, setDateFilter] = useState<string>('') // YYYY-MM-DD format
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // This section owns its own data, so refreshing it never touches the others.
  const fetchEvents = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      // When a date is picked, filter on the SERVER by that local day's UTC
      // bounds + category. A recent-N client-side filter never reaches older
      // days on busy agents. USB events are categorized as "file" by the backend.
      const params: any = { agent_id: agentId, limit: 1000 }
      if (dateFilter) {
        params.category = 'file'
        params.start_time = new Date(`${dateFilter}T00:00:00`).toISOString()
        params.end_time = new Date(`${dateFilter}T23:59:59.999`).toISOString()
      }
      const data = await getEvents(params)
      setAllEvents(data as Event[])
    } catch (e) {
      console.error('Failed to load USB events:', e)
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

  // Filter USB events - explicitly exclude browser_download events
  const usbEvents = events.filter(e => {
    if (e.event_type === 'browser_download' || e.event_type === 'browser_history_visited' || e.event_type === 'browser_search_query') {
      return false
    }
    return e.event_type === 'usb_inserted' ||
      e.event_type === 'usb_removed' ||
      e.event_type === 'usb_file_transfer'
  })

  const dateFilteredEvents = dateFilter
    ? usbEvents.filter(e => {
      const eventDate = parseSafeDate(e.timestamp)
      const filterDate = new Date(`${dateFilter}T00:00:00`)
      return eventDate.toDateString() === filterDate.toDateString()
    })
    : usbEvents

  const filteredEvents = filter === 'all'
    ? dateFilteredEvents
    : dateFilteredEvents.filter(e => e.event_type === filter)

  const insertedEvents = usbEvents.filter(e => e.event_type === 'usb_inserted')
  const removedEvents = usbEvents.filter(e => e.event_type === 'usb_removed')
  const transferEvents = usbEvents.filter(e => e.event_type === 'usb_file_transfer')

  const getEventIcon = (eventType: string, direction?: string) => {
    switch (eventType) {
      case 'usb_inserted':
        return <Usb className="w-4 h-4 text-ct-ok" />
      case 'usb_removed':
        return <X className="w-4 h-4 text-ct-crit" />
      case 'usb_file_transfer':
        return direction === 'to_usb'
          ? <Upload className="w-4 h-4 text-ct-accent" />
          : <Download className="w-4 h-4 text-ct-accent" />
      default:
        return <Usb className="w-4 h-4 text-ct-accent" />
    }
  }

  const getEventTone = (eventType: string): 'ok' | 'crit' | 'accent' => {
    switch (eventType) {
      case 'usb_inserted': return 'ok'
      case 'usb_removed': return 'crit'
      default: return 'accent'
    }
  }

  const formatEventDetails = (event: Event) => {
    if (event.event_type === 'usb_file_transfer') {
      const metadata = event.metadata || {}
      const fileName = metadata.file_name || 'Unknown File'
      const filePath = metadata.file_path || ''
      const direction = metadata.direction === 'to_usb'
        ? 'Copied TO USB'
        : metadata.direction === 'from_usb_to_system'
          ? 'Copied FROM USB (to system)'
          : 'Copied FROM USB'
      const deviceName = metadata.device_name || metadata.device_id || 'Unknown Device'

      return {
        title: `${direction}: ${fileName}`,
        subtitle: filePath,
        device: deviceName,
        fileSize: metadata.file_size ? formatFileSize(metadata.file_size) : null,
      }
    } else {
      const metadata = event.metadata || {}
      const deviceName = metadata.device_name || metadata.device_id || 'Unknown Device'
      return {
        title: event.event_type === 'usb_inserted' ? 'USB Device Inserted' : 'USB Device Removed',
        subtitle: deviceName,
        device: deviceName,
        fileSize: null,
      }
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  function parseSafeDate(ts: string) {
    let iso = ts.replace(' ', 'T')
    if (!iso.endsWith('Z') && !iso.match(/[+-]\d{2}:\d{2}$/)) {
      iso += 'Z'
    }
    return new Date(iso)
  }

  return (
    <Panel>
      <PanelHead
        title={
          <span className="flex items-center gap-2">
            <Usb className="w-4 h-4 text-ct-accent" />
            USB Activity
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
            {onClear && (
              <button
                onClick={onClear}
                disabled={loading || events.length === 0}
                className="p-1.5 rounded-sm border border-ct-line text-ct-crit hover:bg-ct-panel-hi hover:border-ct-crit-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Clear displayed data"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => fetchEvents(false)}
              disabled={loading}
              className="p-1.5 rounded-sm border border-ct-line text-ct-accent hover:bg-ct-panel-hi hover:border-ct-accent-border transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      <div className="p-6 space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-ct-bg2 border border-ct-line">
            <Calendar className="w-3.5 h-3.5 text-ct-ink3" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent border-none text-[12px] text-ct-ink2 font-mono focus:outline-none max-w-[140px]"
              title="Filter events by date"
              style={{ colorScheme: 'dark' }}
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter('')}
                className="p-0.5 text-ct-crit hover:brightness-125 transition-all"
                title="Clear date filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
              All ({dateFilter ? dateFilteredEvents.length : usbEvents.length})
            </Chip>
            <Chip tone="ok" active={filter === 'usb_inserted'} onClick={() => setFilter('usb_inserted')}>
              Inserted ({insertedEvents.length})
            </Chip>
            <Chip tone="crit" active={filter === 'usb_removed'} onClick={() => setFilter('usb_removed')}>
              Removed ({removedEvents.length})
            </Chip>
            <Chip active={filter === 'usb_file_transfer'} onClick={() => setFilter('usb_file_transfer')}>
              Transfers ({transferEvents.length})
            </Chip>
          </div>
        </div>

        {/* Events List */}
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
          {loading ? (
            <div className="text-center py-16 rounded-sm border border-ct-line bg-ct-bg2">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-ct-ink3" />
              <p className="text-[12px] text-ct-ink3 font-mono uppercase" style={{ letterSpacing: '0.18em' }}>Loading USB events</p>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-16 rounded-sm border border-dashed border-ct-line bg-ct-bg2">
              <Usb className="w-10 h-10 mx-auto mb-3 text-ct-ink4" />
              <p className="text-[13px] font-medium mb-1 text-ct-ink2">No USB events found</p>
              <p className="text-[11px] text-ct-ink3">
                {clearTimestamp
                  ? 'Waiting for new events after clear…'
                  : filter === 'all'
                    ? 'Plug in a USB device to see events here.'
                    : `No ${filter.replace('usb_', '').replace('_', ' ')} events found.`}
              </p>
              {clearTimestamp && onResetFilter && (
                <button
                  onClick={onResetFilter}
                  className="mt-5 px-4 py-2 rounded-sm border border-ct-accent-border text-ct-accent text-[11px] font-mono uppercase transition-colors hover:brightness-125"
                  style={{ background: 'var(--ct-accent-soft)', letterSpacing: '0.18em' }}
                >
                  Show All Events
                </button>
              )}
            </div>
          ) : (
            filteredEvents.map((event) => {
              const details = formatEventDetails(event)
              const tone = getEventTone(event.event_type)
              return (
                <div
                  key={event.id}
                  className="p-4 rounded-sm border border-ct-line bg-ct-bg2 hover:bg-ct-panel-hi transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="p-2 rounded-sm border"
                      style={{
                        borderColor:
                          tone === 'ok' ? 'var(--ct-ok-border)' :
                          tone === 'crit' ? 'var(--ct-crit-border)' :
                          'var(--ct-accent-border)',
                        background:
                          tone === 'ok' ? 'var(--ct-ok-soft)' :
                          tone === 'crit' ? 'var(--ct-crit-soft)' :
                          'var(--ct-accent-soft)',
                      }}
                    >
                      {getEventIcon(event.event_type, event.metadata?.direction)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold mb-1 text-ct-ink">
                        {details.title}
                      </p>
                      <p className="text-[12px] mb-2 truncate text-ct-ink3 font-mono">
                        {details.subtitle}
                      </p>
                      <div className="flex items-center flex-wrap gap-2 text-[11px] font-mono text-ct-ink3">
                        <StatusPill tone="idle" dot={false}>DEV: {details.device.substring(0, 30)}</StatusPill>
                        {details.fileSize && <StatusPill tone="accent" dot={false}>SIZE: {details.fileSize}</StatusPill>}
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDistanceToNow(parseSafeDate(event.timestamp), { addSuffix: true })}</span>
                        <span className="tabular-nums">{formatWATTime(event.timestamp)}</span>
                      </div>
                      {event.event_type === 'usb_file_transfer' && event.metadata?.file_path && (
                        <button
                          className="mt-3 inline-flex items-center gap-2 text-[11px] font-mono uppercase px-3 py-1.5 rounded-sm border border-ct-accent-border text-ct-accent transition-colors hover:brightness-125"
                          style={{ background: 'var(--ct-accent-soft)', letterSpacing: '0.18em' }}
                          onClick={() => {
                            window.location.href = `/documents?id=${event.id}`
                          }}
                        >
                          <Eye className="w-3 h-3" />
                          View Document
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </Panel>
  )
}
