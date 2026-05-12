'use client'

import { useState, useEffect, useRef } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { Camera, Download, ZoomIn, X, RefreshCw, Calendar as CalendarIcon, Trash2, ArrowUpDown } from 'lucide-react'
import { downloadFile } from '@/lib/api'

interface Event {
  id: string
  event_type: string
  timestamp: string
  agent_id: string
  metadata?: any
}

interface ScreenshotViewerProps {
  events: Event[]
  loading: boolean
  onRefresh?: () => void
  onClear?: () => void
  clearTimestamp?: Date | null
  onResetFilter?: () => void
}

export default function ScreenshotViewer({
  events,
  loading,
  onRefresh,
  onClear,
  clearTimestamp,
  onResetFilter
}: ScreenshotViewerProps) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<Event | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loadingImage, setLoadingImage] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<string>('')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [thumbnailUrls, setThumbnailUrls] = useState<Map<string, string>>(new Map())
  const [loadingThumbnails, setLoadingThumbnails] = useState<Set<string>>(new Set())
  const [thumbnailErrors, setThumbnailErrors] = useState<Set<string>>(new Set())
  const loadingRef = useRef<Set<string>>(new Set())

  // Filter screenshot events
  const screenshotEvents = events.filter(e => e.event_type === 'screenshot_captured')

  // Apply date filter
  const dateFilteredEvents = dateFilter
    ? screenshotEvents.filter(e => {
      const eventDate = new Date(e.timestamp)
      const filterDate = new Date(dateFilter)
      return eventDate.toDateString() === filterDate.toDateString()
    })
    : screenshotEvents

  // Sort events by timestamp
  const sortedEvents = [...dateFilteredEvents].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime()
    const timeB = new Date(b.timestamp).getTime()
    return sortOrder === 'newest' ? timeB - timeA : timeA - timeB
  })

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const loadScreenshotImage = async (event: Event) => {
    setErrorMessage(null)
    if (!event.metadata?.file_id) {
      setErrorMessage('Screenshot file ID not available')
      return
    }

    setLoadingImage(true)
    setSelectedScreenshot(event)
    setImageUrl(null)

    try {
      const blob = await downloadFile(event.metadata.file_id)
      const url = URL.createObjectURL(blob)
      setImageUrl(url)
    } catch (error: any) {
      console.error('Failed to load screenshot:', error)
      setErrorMessage(`Failed to load screenshot: ${error.message || 'Unknown error'}`)
    } finally {
      setLoadingImage(false)
    }
  }

  const handleDownload = async (event: Event) => {
    setErrorMessage(null)
    if (!event.metadata?.file_id) {
      setErrorMessage('Screenshot file ID not available')
      return
    }

    try {
      const blob = await downloadFile(event.metadata.file_id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      // SECURITY: Sanitize extension to prevent executing html if accidentally served
      let ext = event.metadata.format || 'jpg'
      const safeExts = ['jpg', 'jpeg', 'png', 'webp', 'gif']
      if (!safeExts.includes(ext.toLowerCase())) ext = 'bin'

      link.download = `screenshot_${event.metadata.file_id}.${ext}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      console.error('Download failed:', error)
      setErrorMessage(`Download failed: ${error.message || 'Unknown error'}`)
    }
  }

  // Load thumbnails for all visible screenshots
  useEffect(() => {
    const currentEventIds = new Set(sortedEvents.map(e => e.id))

    // Clean up old thumbnails that are no longer in the list
    setThumbnailUrls(prev => {
      const newMap = new Map()
      prev.forEach((url, eventId) => {
        if (currentEventIds.has(eventId)) {
          newMap.set(eventId, url)
        } else {
          URL.revokeObjectURL(url)
        }
      })
      return newMap
    })

    // Load thumbnails for events that don't have them yet
    sortedEvents.forEach(event => {
      if (!event.metadata?.file_id) return

      // Check if already loaded or loading
      setThumbnailUrls(prevThumbs => {
        if (prevThumbs.has(event.id) || loadingRef.current.has(event.id)) {
          return prevThumbs
        }

        // Mark as loading
        loadingRef.current.add(event.id)
        setLoadingThumbnails(prev => new Set(prev).add(event.id))

        // Load thumbnail asynchronously
        downloadFile(event.metadata.file_id)
          .then(blob => {
            const url = URL.createObjectURL(blob)
            setThumbnailUrls(prev => {
              if (prev.has(event.id)) {
                URL.revokeObjectURL(url)
                return prev
              }
              const newMap = new Map(prev)
              newMap.set(event.id, url)
              return newMap
            })
            setThumbnailErrors(prev => {
              const newSet = new Set(prev)
              newSet.delete(event.id)
              return newSet
            })
          })
          .catch((error: any) => {
            console.error('Failed to load thumbnail for:', event.id, error)
            setThumbnailErrors(prev => new Set(prev).add(event.id))
          })
          .finally(() => {
            loadingRef.current.delete(event.id)
            setLoadingThumbnails(prev => {
              const newSet = new Set(prev)
              newSet.delete(event.id)
              return newSet
            })
          })

        return prevThumbs
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedEvents.map(e => e.id).join(',')])

  const [autoRefresh, setAutoRefresh] = useState(true)

  // Auto-refresh effect — controlled by toggle
  useEffect(() => {
    if (!autoRefresh || !onRefresh) return

    const interval = setInterval(() => {
      onRefresh()
    }, 10000)

    return () => clearInterval(interval)
  }, [autoRefresh, onRefresh])

  // Cleanup image URL on unmount
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl)
      }
    }
  }, [imageUrl])

  // Cleanup all thumbnail URLs on unmount
  useEffect(() => {
    return () => {
      thumbnailUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedScreenshot) {
        setSelectedScreenshot(null)
        if (imageUrl) {
          URL.revokeObjectURL(imageUrl)
          setImageUrl(null)
        }
      }
    }

    window.addEventListener('keydown', handleEscKey)
    return () => window.removeEventListener('keydown', handleEscKey)
  }, [selectedScreenshot, imageUrl])

  return (
    <div className="border rounded-2xl p-6 transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div className="flex items-center space-x-4 flex-wrap gap-2">
          <h2 className="text-xl font-semibold flex items-center transition-colors" style={{ color: 'var(--text-primary)' }}>
            <Camera className="w-5 h-5 mr-2 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
            Screenshots ({screenshotEvents.length})
          </h2>
          {/* Date Filter */}
          <div className="flex items-center space-x-2">
            <CalendarIcon className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-3 py-1 border rounded-lg text-sm focus:outline-none transition-all"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--accent-cyan)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; }}
              title="Filter screenshots by date"
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter('')}
                className="px-2 py-1 rounded-lg text-xs transition-all"
                style={{ backgroundColor: 'rgba(255, 107, 107, 0.2)', color: '#FF6B6B' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)'; }}
                title="Clear date filter"
              >
                Clear
              </button>
            )}
          </div>
          {/* Sort Dropdown */}
          <div className="flex items-center space-x-2">
            <ArrowUpDown className="w-4 h-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
              className="px-3 py-1 border rounded-lg text-sm focus:outline-none transition-all cursor-pointer"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--accent-cyan)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; }}
              title="Sort screenshots by date"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {clearTimestamp && onResetFilter && (
            <button
              onClick={onResetFilter}
              className="px-3 py-1 rounded-lg text-sm font-medium transition-all border"
              style={{ backgroundColor: 'rgba(0, 217, 255, 0.2)', color: 'var(--accent-cyan)', borderColor: 'rgba(0, 217, 255, 0.3)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.3)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.2)'; }}
              title="Show all screenshots (clear timestamp filter)"
            >
              Show All
            </button>
          )}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="px-3 py-1 rounded-lg text-sm font-medium transition-all border"
            style={autoRefresh
              ? { backgroundColor: 'rgba(0, 217, 255, 0.2)', color: 'var(--accent-cyan)', borderColor: 'rgba(0, 217, 255, 0.3)' }
              : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-cyan)', borderColor: 'transparent' }
            }
          >
            Auto: {autoRefresh ? 'ON' : 'OFF'}
          </button>
          {onClear && (
            <button
              onClick={onClear}
              disabled={loading || screenshotEvents.length === 0}
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
              title="Clear displayed screenshots"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {onRefresh && (
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
              title="Refresh screenshots"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Screenshot Gallery */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[600px] overflow-y-auto">
        {loading && sortedEvents.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 transition-colors" style={{ color: 'var(--text-tertiary)' }} />
            <p className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Loading screenshots...</p>
          </div>
        ) : sortedEvents.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <Camera className="w-16 h-16 mx-auto mb-4 transition-colors" style={{ color: 'rgba(0, 217, 255, 0.2)' }} />
            <p className="text-lg font-medium mb-2 transition-colors" style={{ color: 'var(--text-tertiary)' }}>No screenshots found</p>
            <p className="text-sm transition-colors" style={{ color: 'rgba(0, 217, 255, 0.4)' }}>
              {dateFilter
                ? `No screenshots found for selected date`
                : 'Screenshots will appear here when captured by the agent'}
            </p>
            {clearTimestamp && onResetFilter && (
              <button
                onClick={onResetFilter}
                className="mt-4 px-4 py-2 rounded-lg transition-all"
                style={{ backgroundColor: 'rgba(0, 217, 255, 0.2)', color: 'var(--accent-cyan)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.3)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0, 217, 255, 0.2)'; }}
              >
                Show All Screenshots
              </button>
            )}
          </div>
        ) : (
          sortedEvents.map((event) => (
            <div
              key={event.id}
              className="border rounded-lg p-3 cursor-pointer transition-all group"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-cyan)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              onClick={() => loadScreenshotImage(event)}
            >
              <div className="aspect-video rounded mb-2 flex items-center justify-center relative overflow-hidden transition-colors" style={{ backgroundColor: 'var(--bg-primary)' }}>
                {thumbnailUrls.has(event.id) ? (
                  <img
                    src={thumbnailUrls.get(event.id)}
                    alt={`Screenshot ${format(new Date(event.timestamp), 'HH:mm:ss')}`}
                    className="w-full h-full object-cover"
                    onError={() => {
                      setThumbnailErrors(prev => new Set(prev).add(event.id))
                      const url = thumbnailUrls.get(event.id)
                      if (url) {
                        URL.revokeObjectURL(url)
                        setThumbnailUrls(prev => {
                          const newMap = new Map(prev)
                          newMap.delete(event.id)
                          return newMap
                        })
                      }
                    }}
                  />
                ) : loadingThumbnails.has(event.id) ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 animate-spin transition-colors" style={{ color: 'rgba(0, 217, 255, 0.4)' }} />
                  </div>
                ) : thumbnailErrors.has(event.id) ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Camera className="w-8 h-8 transition-colors" style={{ color: 'rgba(0, 217, 255, 0.4)' }} />
                  </div>
                ) : event.metadata?.file_id ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Camera className="w-8 h-8 transition-colors" style={{ color: 'rgba(0, 217, 255, 0.4)' }} />
                  </div>
                ) : (
                  <Camera className="w-8 h-8 transition-colors" style={{ color: 'rgba(0, 217, 255, 0.4)' }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#00D9FF]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <ZoomIn className="w-6 h-6 transition-colors" style={{ color: 'var(--text-primary)' }} />
                </div>
              </div>
              <div className="text-xs space-y-1">
                <p className="truncate font-medium transition-colors" style={{ color: 'var(--text-tertiary)' }}>{format(new Date(event.timestamp), 'MMM dd, yyyy')}</p>
                <p className="truncate transition-colors" style={{ color: 'rgba(0, 217, 255, 0.6)' }}>{format(new Date(event.timestamp), 'HH:mm:ss')}</p>
                <p className="transition-colors" style={{ color: 'rgba(0, 217, 255, 0.5)' }}>
                  {event.metadata?.width && event.metadata?.height
                    ? `${event.metadata.width}x${event.metadata.height}`
                    : 'Unknown size'}
                </p>
                {event.metadata?.file_size && (
                  <p className="transition-colors" style={{ color: 'rgba(0, 217, 255, 0.5)' }}>{formatFileSize(event.metadata.file_size)}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Screenshot Modal */}
      {selectedScreenshot && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setSelectedScreenshot(null)
            if (imageUrl) {
              URL.revokeObjectURL(imageUrl)
              setImageUrl(null)
            }
          }}
        >
          <div
            className="border rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-auto transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold transition-colors" style={{ color: 'var(--text-primary)' }}>
                Screenshot - {format(new Date(selectedScreenshot.timestamp), 'PPpp')}
              </h3>
              <button
                onClick={() => {
                  setSelectedScreenshot(null)
                  if (imageUrl) {
                    URL.revokeObjectURL(imageUrl)
                    setImageUrl(null)
                  }
                }}
                className="p-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <X className="w-5 h-5 transition-colors" style={{ color: 'var(--accent-cyan)' }} />
              </button>
            </div>

            {errorMessage && (
              <div className="mb-4 p-3 rounded-lg flex items-center bg-red-500/10 border border-red-500/20 text-red-500">
                <span className="text-sm font-medium">{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="ml-auto">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {loadingImage ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin transition-colors" style={{ color: 'var(--text-tertiary)' }} />
                <span className="ml-3 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Loading screenshot...</span>
              </div>
            ) : imageUrl ? (
              <div className="space-y-4">
                <div className="rounded-lg p-4 flex items-center justify-center transition-colors" style={{ backgroundColor: 'var(--bg-primary)' }}>
                  <img
                    src={imageUrl}
                    alt="Screenshot"
                    className="max-w-full max-h-[60vh] rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="mb-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Resolution</p>
                    <p className="transition-colors" style={{ color: 'var(--text-primary)' }}>
                      {selectedScreenshot.metadata?.width}x{selectedScreenshot.metadata?.height || 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>File Size</p>
                    <p className="transition-colors" style={{ color: 'var(--text-primary)' }}>
                      {selectedScreenshot.metadata?.file_size
                        ? formatFileSize(selectedScreenshot.metadata.file_size)
                        : 'Unknown'}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Format</p>
                    <p className="transition-colors" style={{ color: 'var(--text-primary)' }}>{selectedScreenshot.metadata?.format || 'Unknown'}</p>
                  </div>
                  <div>
                    <p className="mb-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>Captured</p>
                    <p className="transition-colors" style={{ color: 'var(--text-primary)' }}>
                      {formatDistanceToNow(new Date(selectedScreenshot.timestamp), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(selectedScreenshot)}
                  className="w-full px-4 py-2 rounded-lg transition-all flex items-center justify-center space-x-2 font-medium"
                  style={{ backgroundColor: 'var(--accent-cyan)', color: 'var(--bg-primary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#00B8E6'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-cyan)'; }}
                >
                  <Download className="w-4 h-4" />
                  <span>Download Screenshot</span>
                </button>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>Failed to load screenshot</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

