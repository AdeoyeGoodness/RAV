'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { Camera, Download, ZoomIn, X, RefreshCw, Calendar as CalendarIcon, Trash2, ArrowUpDown } from 'lucide-react'
import { downloadFile, getEvents } from '@/lib/api'

interface Event {
  id: string
  event_type: string
  timestamp: string
  agent_id: string
  metadata?: any
}

interface ScreenshotViewerProps {
  agentId: string
  onClear?: () => void
  clearTimestamp?: Date | null
  onResetFilter?: () => void
}

export default function ScreenshotViewer({
  agentId,
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
  const [allEvents, setAllEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  // This section owns its own data, so refreshing it never touches the others.
  const fetchEvents = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      const data = await getEvents({ agent_id: agentId, limit: 10000 })
      setAllEvents(data as Event[])
    } catch (e) {
      console.error('Failed to load screenshot events:', e)
    } finally {
      if (!background) setLoading(false)
    }
  }, [agentId])

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

  // Filter screenshot events
  const screenshotEvents = events.filter(e => e.event_type === 'screenshot_captured' || e.event_type === 'screenshot_upload_failed')

  const parseSafeDate = (ts: string) => {
    let iso = ts.replace(' ', 'T')
    if (!iso.endsWith('Z') && !iso.match(/[+-]\d{2}:\d{2}$/)) {
      iso += 'Z'
    }
    return new Date(iso)
  }

  // Apply date filter
  const dateFilteredEvents = dateFilter
    ? screenshotEvents.filter(e => {
      const eventDate = parseSafeDate(e.timestamp)
      const filterDate = new Date(dateFilter)
      return eventDate.toDateString() === filterDate.toDateString()
    })
    : screenshotEvents

  // Sort events by timestamp
  const sortedEvents = [...dateFilteredEvents].sort((a, b) => {
    const timeA = parseSafeDate(a.timestamp).getTime()
    const timeB = parseSafeDate(b.timestamp).getTime()
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
    <div className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl p-7 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/5 flex-wrap gap-4">
        <div className="flex items-center space-x-4 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
              <Camera className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Screenshots ({screenshotEvents.length})</h2>
          </div>
          {/* Date Filter */}
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 focus-within:border-blue-500/30 transition-colors">
            <CalendarIcon className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-2 py-1 bg-transparent border-none text-sm text-slate-300 focus:outline-none transition-all"
              style={{ colorScheme: 'dark' }}
              title="Filter screenshots by date"
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
          {/* Sort Dropdown */}
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/5 focus-within:border-blue-500/30 transition-colors">
            <ArrowUpDown className="w-4 h-4 text-slate-400" />
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
              className="bg-transparent border-none text-sm text-slate-300 focus:outline-none cursor-pointer"
              title="Sort screenshots by date"
            >
              <option value="newest" className="bg-slate-900">Newest First</option>
              <option value="oldest" className="bg-slate-900">Oldest First</option>
            </select>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {clearTimestamp && onResetFilter && (
            <button
              onClick={onResetFilter}
              className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20"
              title="Show all screenshots (clear timestamp filter)"
            >
              Show All
            </button>
          )}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border ${
              autoRefresh
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                : 'bg-black/40 text-slate-500 border-white/5 hover:text-slate-300'
            }`}
          >
            Auto: {autoRefresh ? 'ON' : 'OFF'}
          </button>
          {onClear && (
            <button
              onClick={onClear}
              disabled={loading || screenshotEvents.length === 0}
              className="p-2 rounded-lg bg-black/40 border border-white/5 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Clear displayed screenshots"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => fetchEvents(false)}
            disabled={loading}
            className="p-2 rounded-lg bg-black/40 border border-white/5 text-blue-400 hover:bg-blue-500/10 hover:border-blue-500/30 transition-all disabled:opacity-50"
            title="Refresh screenshots"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-300' : ''}`} />
          </button>
        </div>
      </div>

      {/* Screenshot Gallery */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
        {loading && sortedEvents.length === 0 ? (
          <div className="col-span-full text-center py-16 bg-black/20 rounded-xl border border-white/5">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-slate-500" />
            <p className="text-slate-400 font-medium">Loading screenshots...</p>
          </div>
        ) : sortedEvents.length === 0 ? (
          <div className="col-span-full text-center py-16 bg-black/20 rounded-xl border border-dashed border-white/10">
            <Camera className="w-16 h-16 mx-auto mb-4 text-slate-600" />
            <p className="text-lg font-bold mb-2 text-slate-300">No screenshots found</p>
            <p className="text-sm text-slate-500">
              {dateFilter
                ? `No screenshots found for selected date`
                : 'Screenshots will appear here when captured by the agent'}
            </p>
            {clearTimestamp && onResetFilter && (
              <button
                onClick={onResetFilter}
                className="mt-6 px-5 py-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-all font-bold text-xs uppercase tracking-wider"
              >
                Show All Screenshots
              </button>
            )}
          </div>
        ) : (
          sortedEvents.map((event) => (
            <div
              key={event.id}
              className={`bg-black/40 border ${event.event_type === 'screenshot_upload_failed' ? 'border-rose-500/20 hover:border-rose-500/40' : 'border-white/5 hover:border-blue-500/40'} rounded-xl p-3 cursor-pointer hover:bg-white/[0.04] hover:-translate-y-1 hover:shadow-lg transition-all duration-300 group`}
              onClick={() => {
                if (event.event_type === 'screenshot_upload_failed') {
                  setErrorMessage(`Upload failed (Offline or network error): ${event.metadata?.upload_error || 'Unknown error'}`)
                  setTimeout(() => setErrorMessage(null), 5000)
                } else {
                  loadScreenshotImage(event)
                }
              }}
            >
              <div className={`aspect-video rounded-lg mb-3 flex items-center justify-center relative overflow-hidden bg-slate-950 border ${event.event_type === 'screenshot_upload_failed' ? 'border-rose-500/20 group-hover:border-rose-500/30' : 'border-white/5 group-hover:border-blue-500/30'} transition-colors`}>
                {event.event_type === 'screenshot_upload_failed' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-rose-500/5">
                    <Camera className="w-8 h-8 text-rose-500/40 mb-2" />
                    <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Upload Failed</span>
                    <span className="text-[8px] font-mono text-rose-500/60 mt-1 truncate w-full px-2" title={event.metadata?.upload_error}>OFFLINE / NETWORK ERROR</span>
                  </div>
                ) : thumbnailUrls.has(event.id) ? (
                  <img
                    src={thumbnailUrls.get(event.id)}
                    alt={`Screenshot ${format(parseSafeDate(event.timestamp), 'HH:mm:ss')}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
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
                    <RefreshCw className="w-6 h-6 animate-spin text-blue-500/50" />
                  </div>
                ) : thumbnailErrors.has(event.id) ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Camera className="w-8 h-8 text-rose-500/30" />
                  </div>
                ) : event.metadata?.file_id ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Camera className="w-8 h-8 text-blue-500/30" />
                  </div>
                ) : (
                  <Camera className="w-8 h-8 text-slate-600" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-blue-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[2px]">
                  <ZoomIn className="w-8 h-8 text-white drop-shadow-lg" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-white tracking-wider uppercase">{format(parseSafeDate(event.timestamp), 'MMM dd, yyyy')}</p>
                  <p className="text-xs font-mono text-blue-400">{format(parseSafeDate(event.timestamp), 'HH:mm:ss')}</p>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span className="bg-white/5 px-1.5 py-0.5 rounded">
                    {event.metadata?.width && event.metadata?.height
                      ? `${event.metadata.width}x${event.metadata.height}`
                      : 'Unknown'}
                  </span>
                  {event.metadata?.file_size && (
                    <span className="text-emerald-400/70">{formatFileSize(event.metadata.file_size)}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Screenshot Modal */}
      {selectedScreenshot && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => {
            setSelectedScreenshot(null)
            if (imageUrl) {
              URL.revokeObjectURL(imageUrl)
              setImageUrl(null)
            }
          }}
        >
          <div
            className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
              <h3 className="text-xl font-bold text-white tracking-tight flex items-center gap-3">
                <Camera className="w-5 h-5 text-blue-400" />
                Snapshot taken on <span className="text-blue-400">{format(parseSafeDate(selectedScreenshot.timestamp), 'PPpp')}</span>
              </h3>
              <button
                onClick={() => {
                  setSelectedScreenshot(null)
                  if (imageUrl) {
                    URL.revokeObjectURL(imageUrl)
                    setImageUrl(null)
                  }
                }}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMessage && (
              <div className="mb-6 p-4 rounded-xl flex items-center bg-rose-500/10 border border-rose-500/20 text-rose-400">
                <span className="text-sm font-bold">{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="ml-auto hover:text-rose-300">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {loadingImage ? (
              <div className="flex flex-col items-center justify-center py-24 bg-black/40 rounded-xl border border-dashed border-white/10">
                <RefreshCw className="w-10 h-10 animate-spin text-blue-500 mb-4" />
                <span className="text-slate-400 font-medium">Decrypting and loading full resolution image...</span>
              </div>
            ) : imageUrl ? (
              <div className="space-y-6">
                <div className="rounded-xl p-2 bg-black border border-white/10 flex items-center justify-center group overflow-hidden relative">
                  <img
                    src={imageUrl}
                    alt="Screenshot"
                    className="max-w-full max-h-[60vh] rounded-lg shadow-2xl object-contain transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white/5 border border-white/5 rounded-xl p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Resolution</p>
                    <p className="text-sm font-mono text-white">
                      {selectedScreenshot.metadata?.width}x{selectedScreenshot.metadata?.height || 'Unknown'}
                    </p>
                  </div>
                  <div className="bg-white/5 border border-white/5 rounded-xl p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">File Size</p>
                    <p className="text-sm font-mono text-emerald-400">
                      {selectedScreenshot.metadata?.file_size
                        ? formatFileSize(selectedScreenshot.metadata.file_size)
                        : 'Unknown'}
                    </p>
                  </div>
                  <div className="bg-white/5 border border-white/5 rounded-xl p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Format</p>
                    <p className="text-sm font-bold text-white uppercase">{selectedScreenshot.metadata?.format || 'Unknown'}</p>
                  </div>
                  <div className="bg-white/5 border border-white/5 rounded-xl p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Time Elapsed</p>
                    <p className="text-sm font-medium text-blue-400">
                      {formatDistanceToNow(new Date(selectedScreenshot.timestamp), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDownload(selectedScreenshot)}
                  className="w-full px-6 py-4 rounded-xl bg-blue-500 hover:bg-blue-400 text-black font-bold uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(59,130,246,0.2)] hover:shadow-[0_0_30px_rgba(59,130,246,0.4)] hover:-translate-y-0.5 flex items-center justify-center space-x-3"
                >
                  <Download className="w-5 h-5" />
                  <span>Download Original Evidence</span>
                </button>
              </div>
            ) : (
              <div className="text-center py-24 bg-black/40 rounded-xl border border-dashed border-white/10">
                <Camera className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                <p className="text-slate-400 font-medium">Failed to load screenshot data.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

