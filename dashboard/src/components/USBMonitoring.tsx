'use client'

import { useState, useEffect } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { RefreshCw, Download, Upload, Usb, X, FileText, Eye, Trash2, Calendar } from 'lucide-react'

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
        const eventDate = new Date(e.timestamp)
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

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh || !onRefresh) return
    
    const interval = setInterval(() => {
      onRefresh()
    }, 10000) // Refresh every 10 seconds

    return () => clearInterval(interval)
  }, [autoRefresh, onRefresh])

  return (
    <div className="border rounded-2xl p-6 transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
      {/* Header with Filters */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4 flex-wrap">
          <h2 className="text-xl font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>USB Monitoring</h2>
          <div className="flex items-center space-x-2">
            {/* Date Filter */}
            <div className="flex items-center space-x-2 px-3 py-1 rounded-lg border transition-colors" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}>
              <Calendar className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-2 py-1 bg-transparent border-none text-sm focus:outline-none transition-all max-w-[140px]"
                style={{ color: 'var(--text-primary)' }}
                title="Filter events by date"
              />
              {dateFilter && (
                <button
                  onClick={() => setDateFilter('')}
                  className="p-1 rounded transition-all"
                  style={{ color: '#FF6B6B' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  title="Clear date filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                filter === 'all'
                  ? ''
                  : ''
              }`}
              style={filter === 'all' 
                ? { backgroundColor: 'var(--accent-cyan)', color: 'var(--bg-primary)' }
                : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-cyan)' }
              }
              onMouseEnter={(e) => {
                if (filter !== 'all') {
                  e.currentTarget.style.opacity = '0.8'
                }
              }}
              onMouseLeave={(e) => {
                if (filter !== 'all') {
                  e.currentTarget.style.opacity = '1'
                }
              }}
            >
              All ({dateFilter ? dateFilteredEvents.length : usbEvents.length})
            </button>
            <button
              onClick={() => setFilter('usb_inserted')}
              className="px-3 py-1 rounded-lg text-sm font-medium transition-all"
              style={filter === 'usb_inserted'
                ? { backgroundColor: '#00FF88', color: 'var(--bg-primary)' }
                : { backgroundColor: 'var(--bg-tertiary)', color: 'rgba(0, 255, 136, 0.7)' }
              }
              onMouseEnter={(e) => {
                if (filter !== 'usb_inserted') {
                  e.currentTarget.style.opacity = '0.8'
                }
              }}
              onMouseLeave={(e) => {
                if (filter !== 'usb_inserted') {
                  e.currentTarget.style.opacity = '1'
                }
              }}
            >
              Inserted ({insertedEvents.length})
            </button>
            <button
              onClick={() => setFilter('usb_removed')}
              className="px-3 py-1 rounded-lg text-sm font-medium transition-all"
              style={filter === 'usb_removed'
                ? { backgroundColor: '#FF6B6B', color: 'var(--bg-primary)' }
                : { backgroundColor: 'var(--bg-tertiary)', color: 'rgba(255, 107, 107, 0.7)' }
              }
              onMouseEnter={(e) => {
                if (filter !== 'usb_removed') {
                  e.currentTarget.style.opacity = '0.8'
                }
              }}
              onMouseLeave={(e) => {
                if (filter !== 'usb_removed') {
                  e.currentTarget.style.opacity = '1'
                }
              }}
            >
              Removed ({removedEvents.length})
            </button>
            <button
              onClick={() => setFilter('usb_file_transfer')}
              className="px-3 py-1 rounded-lg text-sm font-medium transition-all"
              style={filter === 'usb_file_transfer'
                ? { backgroundColor: 'var(--accent-purple)', color: '#ffffff' }
                : { backgroundColor: 'var(--bg-tertiary)', color: 'rgba(108, 92, 231, 0.7)' }
              }
              onMouseEnter={(e) => {
                if (filter !== 'usb_file_transfer') {
                  e.currentTarget.style.opacity = '0.8'
                }
              }}
              onMouseLeave={(e) => {
                if (filter !== 'usb_file_transfer') {
                  e.currentTarget.style.opacity = '1'
                }
              }}
            >
              Transfers ({transferEvents.length})
            </button>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="px-3 py-1 rounded-lg text-sm font-medium transition-all border"
            style={autoRefresh
              ? { backgroundColor: 'rgba(0, 217, 255, 0.2)', color: 'var(--accent-cyan)', borderColor: 'rgba(0, 217, 255, 0.3)' }
              : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-cyan)', borderColor: 'transparent' }
            }
            onMouseEnter={(e) => {
              if (!autoRefresh) {
                e.currentTarget.style.opacity = '0.8'
              }
            }}
            onMouseLeave={(e) => {
              if (!autoRefresh) {
                e.currentTarget.style.opacity = '1'
              }
            }}
          >
            Auto: {autoRefresh ? 'ON' : 'OFF'}
          </button>
          {onClear && (
            <button
              onClick={onClear}
              disabled={loading || events.length === 0}
              className="p-2 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: '#FF6B6B' }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)'
                }
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'
                }
              }}
              title="Clear displayed data"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 rounded-lg transition-all disabled:opacity-50"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-cyan)' }}
            onMouseEnter={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.opacity = '0.8'
              }
            }}
            onMouseLeave={(e) => {
              if (!e.currentTarget.disabled) {
                e.currentTarget.style.opacity = '1'
              }
            }}
            title="Refresh data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="space-y-3 max-h-[600px] overflow-y-auto">
        {loading ? (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
            <p className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Loading USB events...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-12">
            <Usb className="w-16 h-16 mx-auto mb-4 transition-colors" style={{ color: 'rgba(0, 217, 255, 0.2)' }} />
            <p className="text-lg font-medium mb-2 transition-colors" style={{ color: 'var(--text-tertiary)' }}>No USB events found</p>
            <p className="text-sm transition-colors" style={{ color: 'rgba(0, 217, 255, 0.4)' }}>
              {clearTimestamp 
                ? 'Waiting for new events after clear...'
                : filter === 'all' 
                  ? 'Plug in a USB device to see events here'
                  : `No ${filter.replace('usb_', '').replace('_', ' ')} events found`}
            </p>
            {clearTimestamp && onResetFilter && (
              <button
                onClick={onResetFilter}
                className="mt-4 px-4 py-2 rounded-lg transition-all text-sm"
                style={{ backgroundColor: 'rgba(0, 217, 255, 0.2)', color: 'var(--accent-cyan)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.2)'; }}
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
                className={`p-4 rounded-lg border ${getEventColor(event.event_type)} transition-all hover:border-opacity-50`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1">
                    {getEventIcon(event.event_type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold mb-1 transition-colors" style={{ color: 'var(--text-primary)' }}>
                        {details.title}
                      </p>
                      <p className="text-xs mb-2 truncate transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                        {details.subtitle}
                      </p>
                      <div className="flex items-center space-x-4 text-xs transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                        <span>Device: {details.device.substring(0, 30)}</span>
                        {details.fileSize && <span>Size: {details.fileSize}</span>}
                        <span>{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}</span>
                        <span>{format(new Date(event.timestamp), 'HH:mm:ss')}</span>
                      </div>
                      {event.event_type === 'usb_file_transfer' && event.metadata?.file_path && (
                        <button
                          className="mt-2 flex items-center space-x-1 text-xs transition-colors"
                          style={{ color: 'var(--accent-cyan)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#00FF88'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--accent-cyan)'; }}
                          onClick={() => {
                            window.location.href = `/documents?id=${event.id}`
                          }}
                        >
                          <Eye className="w-3 h-3" />
                          <span>View Document</span>
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

