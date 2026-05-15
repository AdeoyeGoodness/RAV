'use client'

import { useState, useEffect } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { RefreshCw, Download, Upload, Usb, X, FileText, Eye, Trash2, Calendar, Clock } from 'lucide-react'

interface Event {
  id: string
  event_type: string
  timestamp: string
  agent_id: string
  metadata?: any
}

interface USBMonitoringProps {
  events: Event[]
  loading: boolean
  onRefresh?: () => void
  onClear?: () => void
  clearTimestamp?: Date | null
  onResetFilter?: () => void
}

export default function USBMonitoring({ events, loading, onRefresh, onClear, clearTimestamp, onResetFilter }: USBMonitoringProps) {
  const [filter, setFilter] = useState<'all' | 'usb_inserted' | 'usb_removed' | 'usb_file_transfer'>('all')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [dateFilter, setDateFilter] = useState<string>('') // YYYY-MM-DD format

  // Filter USB events - explicitly exclude browser_download events
  // to prevent them from appearing in USB monitoring section
  const usbEvents = events.filter(e => {
    // Never show browser downloads in USB monitoring
    if (e.event_type === 'browser_download' || e.event_type === 'browser_history_visited' || e.event_type === 'browser_search_query') {
      return false
    }
    // Only show actual USB-related events
    return e.event_type === 'usb_inserted' || 
           e.event_type === 'usb_removed' || 
           e.event_type === 'usb_file_transfer'
  })

  // Apply date filter
  const dateFilteredEvents = dateFilter
    ? usbEvents.filter(e => {
        const eventDate = parseSafeDate(e.timestamp)
        const filterDate = new Date(dateFilter)
        // Compare dates (ignore time)
        return eventDate.toDateString() === filterDate.toDateString()
      })
    : usbEvents

  // Apply type filter
  const filteredEvents = filter === 'all' 
    ? dateFilteredEvents 
    : dateFilteredEvents.filter(e => e.event_type === filter)

  // Group events by type
  const insertedEvents = usbEvents.filter(e => e.event_type === 'usb_inserted')
  const removedEvents = usbEvents.filter(e => e.event_type === 'usb_removed')
  const transferEvents = usbEvents.filter(e => e.event_type === 'usb_file_transfer')
  
  // Separate active transfers from existing files (if we add metadata flag later)
  // For now, all transfers are shown together

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'usb_inserted':
        return <Usb className="w-5 h-5 text-[#00FF88]" />
      case 'usb_removed':
        return <X className="w-5 h-5 text-[#FF6B6B]" />
      case 'usb_file_transfer':
        const direction = filteredEvents.find(e => e.id === filteredEvents[0]?.id)?.metadata?.direction
        return direction === 'to_usb' 
          ? <Upload className="w-5 h-5 text-[#00D9FF]" />
          : <Download className="w-5 h-5 text-[#6C5CE7]" />
      default:
        return <Usb className="w-5 h-5 text-[#00D9FF]" />
    }
  }

  const getEventColor = (eventType: string) => {
    switch (eventType) {
      case 'usb_inserted':
        return 'border-[#00FF88]/30 bg-[#00FF88]/10'
      case 'usb_removed':
        return 'border-[#FF6B6B]/30 bg-[#FF6B6B]/10'
      case 'usb_file_transfer':
        return 'border-[#00D9FF]/30 bg-[#00D9FF]/10'
      default:
        return 'border-[#00D9FF]/30 bg-[#00D9FF]/10'
    }
  }

  const formatEventDetails = (event: Event) => {
    if (event.event_type === 'usb_file_transfer') {
      const metadata = event.metadata || {}
      const fileName = metadata.file_name || 'Unknown File'
      const filePath = metadata.file_path || ''
      const direction = metadata.direction === 'to_usb' ? 'Copied TO USB' : 'Copied FROM USB'
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

  const parseSafeDate = (ts: string) => {
    let iso = ts.replace(' ', 'T')
    if (!iso.endsWith('Z') && !iso.match(/[+-]\d{2}:\d{2}$/)) {
      iso += 'Z'
    }
    return new Date(iso)
  }

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh || !onRefresh) return
    
    const interval = setInterval(() => {
      onRefresh()
    }, 10000) // Refresh every 10 seconds

    return () => clearInterval(interval)
  }, [autoRefresh, onRefresh])

  return (
    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl p-7 shadow-xl">
      {/* Header with Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 pb-6 border-b border-white/5">
        <div className="flex items-center space-x-4 flex-wrap gap-y-3">
          <div className="flex items-center gap-3 mr-4">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <Usb className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">USB Activity</h2>
          </div>
          <div className="flex items-center space-x-2">
            {/* Date Filter */}
            <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 focus-within:border-cyan-500/30 transition-colors">
              <Calendar className="w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-2 py-1 bg-transparent border-none text-sm text-slate-300 focus:outline-none transition-all max-w-[140px]"
                title="Filter events by date"
                style={{ colorScheme: 'dark' }}
              />
              {dateFilter && (
                <button
                  onClick={() => setDateFilter('')}
                  className="p-1 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all"
                  title="Clear date filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2 bg-black/40 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                filter === 'all'
                  ? 'bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              All ({dateFilter ? dateFilteredEvents.length : usbEvents.length})
            </button>
            <button
              onClick={() => setFilter('usb_inserted')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                filter === 'usb_inserted'
                  ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Inserted ({insertedEvents.length})
            </button>
            <button
              onClick={() => setFilter('usb_removed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                filter === 'usb_removed'
                  ? 'bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.3)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Removed ({removedEvents.length})
            </button>
            <button
              onClick={() => setFilter('usb_file_transfer')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                filter === 'usb_file_transfer'
                  ? 'bg-violet-500 text-white shadow-[0_0_15px_rgba(139,92,246,0.3)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              Transfers ({transferEvents.length})
            </button>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border ${
              autoRefresh
                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.1)]'
                : 'bg-black/40 text-slate-500 border-white/5 hover:text-slate-300'
            }`}
          >
            Auto: {autoRefresh ? 'ON' : 'OFF'}
          </button>
          {onClear && (
            <button
              onClick={onClear}
              disabled={loading || events.length === 0}
              className="p-2 rounded-lg bg-black/40 border border-white/5 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Clear displayed data"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 rounded-lg bg-black/40 border border-white/5 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/30 transition-all disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-300' : ''}`} />
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
        {loading ? (
          <div className="text-center py-16 bg-black/20 rounded-xl border border-white/5">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-slate-500" />
            <p className="text-slate-400 font-medium">Loading USB events...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-16 bg-black/20 rounded-xl border border-dashed border-white/10">
            <Usb className="w-16 h-16 mx-auto mb-4 text-slate-600" />
            <p className="text-lg font-bold mb-2 text-slate-300">No USB events found</p>
            <p className="text-sm text-slate-500">
              {clearTimestamp 
                ? 'Waiting for new events after clear...'
                : filter === 'all' 
                  ? 'Plug in a USB device to see events here'
                  : `No ${filter.replace('usb_', '').replace('_', ' ')} events found`}
            </p>
            {clearTimestamp && onResetFilter && (
              <button
                onClick={onResetFilter}
                className="mt-6 px-5 py-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all font-bold text-xs uppercase tracking-wider"
              >
                Show All Events
              </button>
            )}
          </div>
        ) : (
          filteredEvents.map((event) => {
            const details = formatEventDetails(event)
            return (
              <div
                key={event.id}
                className={`p-5 rounded-xl border ${getEventColor(event.event_type)} hover:brightness-110 transition-all bg-white/[0.02]`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-4 flex-1">
                    <div className={`p-2.5 rounded-lg bg-black/40 ${getEventColor(event.event_type).split(' ')[0]}`}>
                      {getEventIcon(event.event_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold mb-1 text-white">
                        {details.title}
                      </p>
                      <p className="text-sm mb-3 truncate text-slate-400">
                        {details.subtitle}
                      </p>
                      <div className="flex items-center space-x-4 text-[11px] font-mono text-slate-500">
                        <span className="bg-black/50 px-2 py-1 rounded text-slate-300">DEV: {details.device.substring(0, 30)}</span>
                        {details.fileSize && <span className="bg-black/50 px-2 py-1 rounded text-cyan-400">SIZE: {details.fileSize}</span>}
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDistanceToNow(parseSafeDate(event.timestamp), { addSuffix: true })}</span>
                        <span>{format(parseSafeDate(event.timestamp), 'HH:mm:ss')}</span>
                      </div>
                      {event.event_type === 'usb_file_transfer' && event.metadata?.file_path && (
                        <button
                          className="mt-4 flex items-center space-x-2 text-xs font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 px-3 py-1.5 rounded-lg border border-cyan-500/20 transition-all uppercase tracking-wider"
                          onClick={() => {
                            window.location.href = `/documents?id=${event.id}`
                          }}
                        >
                          <Eye className="w-3 h-3" />
                          <span>View Document Analysis</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

