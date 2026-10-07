'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { formatWATTime, formatWATPattern } from '@/lib/time'
import { Camera, Download, ZoomIn, X, RefreshCw, Calendar as CalendarIcon, Trash2, ArrowUpDown } from 'lucide-react'
import { downloadFile, getAgentScreenshots, getAgentScreenshotDuplicates } from '@/lib/api'
import { Panel, PanelHead, Eyebrow, ActionButton, StatusPill } from '@/components/ct/primitives'

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
  // Set of file_ids the backend perceptual-hash pass tagged as near-copies
  // of an older screenshot. We hide those thumbnails and surface the count
  // as an "N duplicates suppressed" chip.
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(new Set())

  // This section owns its own data, so refreshing it never touches the others.
  const fetchEvents = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      // Read screenshots from the `files` table (durable source of truth for the
      // images) instead of the `events` feed, so the gallery survives event
      // purges (the 5-day archive purge or a one-off truncate) — the images
      // persist in `files` even when their events are gone.
      const params: { start_time?: string; end_time?: string; limit?: number } = { limit: 1000 }
      if (dateFilter) {
        params.start_time = new Date(`${dateFilter}T00:00:00`).toISOString()
        params.end_time = new Date(`${dateFilter}T23:59:59.999`).toISOString()
      }
      // Fetch screenshots + dedup roster in parallel. Dedup call is best-effort;
      // if it fails we render everything (unfiltered) rather than block.
      const [data, dups] = await Promise.all([
        getAgentScreenshots(agentId, params),
        getAgentScreenshotDuplicates(agentId).catch(() => []),
      ])
      setAllEvents(data as Event[])
      setDuplicateIds(new Set(dups.map((d) => d.file_id)))
    } catch (e) {
      console.error('Failed to load screenshot events:', e)
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

  const allScreenshotEvents = events.filter(e => e.event_type === 'screenshot_captured' || e.event_type === 'screenshot_upload_failed')
  // Filter out near-duplicate captures the backend flagged. Failed uploads
  // (screenshot_upload_failed) don't have a file_id, so they always pass.
  const screenshotEvents = allScreenshotEvents.filter(e => {
    const fid = e.metadata?.file_id
    return !fid || !duplicateIds.has(fid)
  })
  const suppressedDuplicates = allScreenshotEvents.length - screenshotEvents.length

  const parseSafeDate = (ts: string) => {
    let iso = ts.replace(' ', 'T')
    if (!iso.endsWith('Z') && !iso.match(/[+-]\d{2}:\d{2}$/)) {
      iso += 'Z'
    }
    return new Date(iso)
  }

  const dateFilteredEvents = dateFilter
    ? screenshotEvents.filter(e => {
      const eventDate = parseSafeDate(e.timestamp)
      const filterDate = new Date(`${dateFilter}T00:00:00`)
      return eventDate.toDateString() === filterDate.toDateString()
    })
    : screenshotEvents

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

  useEffect(() => {
    const currentEventIds = new Set(sortedEvents.map(e => e.id))

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

    sortedEvents.forEach(event => {
      if (!event.metadata?.file_id) return

      setThumbnailUrls(prevThumbs => {
        if (prevThumbs.has(event.id) || loadingRef.current.has(event.id)) {
          return prevThumbs
        }

        loadingRef.current.add(event.id)
        setLoadingThumbnails(prev => new Set(prev).add(event.id))

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

  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl)
      }
    }
  }, [imageUrl])

  useEffect(() => {
    return () => {
      thumbnailUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

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
    <Panel>
      <PanelHead
        title={
          <span className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-ct-accent" />
            Screenshots
          </span>
        }
        meta={
          suppressedDuplicates > 0
            ? `${screenshotEvents.length} captures · ${suppressedDuplicates} near-duplicate${suppressedDuplicates === 1 ? '' : 's'} suppressed`
            : `${screenshotEvents.length} captures`
        }
        live={autoRefresh}
        right={
          <div className="flex items-center gap-2">
            {clearTimestamp && onResetFilter && (
              <button
                onClick={onResetFilter}
                className="font-mono text-[10px] uppercase px-2 py-1 rounded-sm border border-ct-accent-border text-ct-accent transition-colors"
                style={{ background: 'var(--ct-accent-soft)', letterSpacing: '0.18em' }}
              >
                Show All
              </button>
            )}
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
                disabled={loading || screenshotEvents.length === 0}
                className="p-1.5 rounded-sm border border-ct-line text-ct-crit hover:bg-ct-panel-hi hover:border-ct-crit-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Clear displayed screenshots"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => fetchEvents(false)}
              disabled={loading}
              className="p-1.5 rounded-sm border border-ct-line text-ct-accent hover:bg-ct-panel-hi hover:border-ct-accent-border transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      <div className="p-6 space-y-5">
        {/* Filters */}
        <div className="flex items-center flex-wrap gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-ct-bg2 border border-ct-line">
            <CalendarIcon className="w-3.5 h-3.5 text-ct-ink3" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="bg-transparent border-none text-[12px] text-ct-ink2 font-mono focus:outline-none"
              style={{ colorScheme: 'dark' }}
              title="Filter screenshots by date"
            />
            {dateFilter && (
              <button
                onClick={() => setDateFilter('')}
                className="p-0.5 text-ct-crit hover:brightness-125"
                title="Clear date filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm bg-ct-bg2 border border-ct-line">
            <ArrowUpDown className="w-3.5 h-3.5 text-ct-ink3" />
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
              className="bg-transparent border-none text-[12px] text-ct-ink2 font-mono focus:outline-none cursor-pointer"
              title="Sort screenshots by date"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
        </div>

        {/* Gallery */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[600px] overflow-y-auto pr-1">
          {loading && sortedEvents.length === 0 ? (
            <div className="col-span-full text-center py-16 rounded-sm border border-ct-line bg-ct-bg2">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-ct-ink3" />
              <p className="text-[12px] text-ct-ink3 font-mono uppercase" style={{ letterSpacing: '0.18em' }}>Loading screenshots</p>
            </div>
          ) : sortedEvents.length === 0 ? (
            <div className="col-span-full text-center py-16 rounded-sm border border-dashed border-ct-line bg-ct-bg2">
              <Camera className="w-10 h-10 mx-auto mb-3 text-ct-ink4" />
              <p className="text-[13px] font-medium mb-1 text-ct-ink2">No screenshots found</p>
              <p className="text-[11px] text-ct-ink3">
                {dateFilter
                  ? `No screenshots found for selected date.`
                  : 'Screenshots will appear here when captured by the agent.'}
              </p>
            </div>
          ) : (
            sortedEvents.map((event) => (
              <div
                key={event.id}
                className="rounded-sm p-2 cursor-pointer transition-colors group border"
                style={{
                  borderColor: event.event_type === 'screenshot_upload_failed' ? 'var(--ct-crit-border)' : 'var(--ct-line)',
                  background: 'var(--ct-bg2)',
                }}
                onClick={() => {
                  if (event.event_type === 'screenshot_upload_failed') {
                    setErrorMessage(`Upload failed (Offline or network error): ${event.metadata?.upload_error || 'Unknown error'}`)
                    setTimeout(() => setErrorMessage(null), 5000)
                  } else {
                    loadScreenshotImage(event)
                  }
                }}
              >
                <div
                  className="aspect-video rounded-sm mb-2 flex items-center justify-center relative overflow-hidden bg-ct-bg border border-ct-line group-hover:border-ct-accent-border transition-colors"
                >
                  {event.event_type === 'screenshot_upload_failed' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center" style={{ background: 'var(--ct-crit-soft)' }}>
                      <Camera className="w-6 h-6 text-ct-crit mb-1" />
                      <span className="font-mono text-[10px] uppercase text-ct-crit" style={{ letterSpacing: '0.18em' }}>Upload Failed</span>
                    </div>
                  ) : thumbnailUrls.has(event.id) ? (
                    <img
                      src={thumbnailUrls.get(event.id)}
                      alt={`Screenshot ${formatWATTime(event.timestamp)}`}
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
                      <RefreshCw className="w-5 h-5 animate-spin text-ct-ink4" />
                    </div>
                  ) : thumbnailErrors.has(event.id) ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Camera className="w-6 h-6 text-ct-crit" />
                    </div>
                  ) : (
                    <Camera className="w-6 h-6 text-ct-ink4" />
                  )}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <ZoomIn className="w-6 h-6 text-ct-ink" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-mono uppercase text-ct-ink2" style={{ letterSpacing: '0.14em' }}>{formatWATPattern(event.timestamp, 'MMM dd, yyyy')}</p>
                    <p className="text-[11px] font-mono text-ct-accent tabular-nums">{formatWATTime(event.timestamp)}</p>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-ct-ink3">
                    <span>
                      {event.metadata?.width && event.metadata?.height
                        ? `${event.metadata.width}x${event.metadata.height}`
                        : 'Unknown'}
                    </span>
                    {event.metadata?.file_size && (
                      <span className="text-ct-ok">{formatFileSize(event.metadata.file_size)}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Screenshot Modal */}
      {selectedScreenshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ct-bg/90 backdrop-blur-sm"
          onClick={() => {
            setSelectedScreenshot(null)
            if (imageUrl) {
              URL.revokeObjectURL(imageUrl)
              setImageUrl(null)
            }
          }}
        >
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <Panel>
              <PanelHead
                title={
                  <span className="flex items-center gap-2">
                    <Camera className="w-4 h-4 text-ct-accent" />
                    Snapshot &mdash;{' '}
                    <span className="text-ct-accent font-mono">{formatWATPattern(selectedScreenshot.timestamp, 'PPpp')}</span>
                  </span>
                }
                right={
                  <button
                    onClick={() => {
                      setSelectedScreenshot(null)
                      if (imageUrl) {
                        URL.revokeObjectURL(imageUrl)
                        setImageUrl(null)
                      }
                    }}
                    className="p-1.5 rounded-sm border border-ct-line text-ct-ink3 hover:text-ct-ink hover:bg-ct-panel-hi transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                }
              />

              <div className="p-6 space-y-5">
                {errorMessage && (
                  <div
                    className="p-3 rounded-sm border flex items-center"
                    style={{ background: 'var(--ct-crit-soft)', borderColor: 'var(--ct-crit-border)', color: 'var(--ct-crit)' }}
                  >
                    <span className="text-[12px] font-medium">{errorMessage}</span>
                    <button onClick={() => setErrorMessage(null)} className="ml-auto hover:brightness-125">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {loadingImage ? (
                  <div className="flex flex-col items-center justify-center py-16 rounded-sm border border-dashed border-ct-line bg-ct-bg2">
                    <RefreshCw className="w-7 h-7 animate-spin text-ct-accent mb-3" />
                    <span className="text-[12px] text-ct-ink3 font-mono uppercase" style={{ letterSpacing: '0.18em' }}>Loading full resolution</span>
                  </div>
                ) : imageUrl ? (
                  <div className="space-y-5">
                    <div className="rounded-sm border border-ct-line bg-ct-bg flex items-center justify-center overflow-hidden">
                      <img
                        src={imageUrl}
                        alt="Screenshot"
                        className="max-w-full max-h-[60vh] object-contain"
                      />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="rounded-sm border border-ct-line bg-ct-bg2 p-4">
                        <Eyebrow className="mb-1">Resolution</Eyebrow>
                        <p className="text-[13px] font-mono text-ct-ink tabular-nums">
                          {selectedScreenshot.metadata?.width}x{selectedScreenshot.metadata?.height || 'Unknown'}
                        </p>
                      </div>
                      <div className="rounded-sm border border-ct-line bg-ct-bg2 p-4">
                        <Eyebrow className="mb-1">File Size</Eyebrow>
                        <p className="text-[13px] font-mono text-ct-ok tabular-nums">
                          {selectedScreenshot.metadata?.file_size
                            ? formatFileSize(selectedScreenshot.metadata.file_size)
                            : 'Unknown'}
                        </p>
                      </div>
                      <div className="rounded-sm border border-ct-line bg-ct-bg2 p-4">
                        <Eyebrow className="mb-1">Format</Eyebrow>
                        <p className="text-[13px] font-mono text-ct-ink uppercase">{selectedScreenshot.metadata?.format || 'Unknown'}</p>
                      </div>
                      <div className="rounded-sm border border-ct-line bg-ct-bg2 p-4">
                        <Eyebrow className="mb-1">Time Elapsed</Eyebrow>
                        <p className="text-[13px] text-ct-accent">
                          {formatDistanceToNow(new Date(selectedScreenshot.timestamp), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <ActionButton onClick={() => handleDownload(selectedScreenshot)} variant="primary" className="w-full py-3">
                      <span className="inline-flex items-center justify-center gap-2">
                        <Download className="w-3.5 h-3.5" />
                        Download Original Evidence
                      </span>
                    </ActionButton>
                  </div>
                ) : (
                  <div className="text-center py-16 rounded-sm border border-dashed border-ct-line bg-ct-bg2">
                    <Camera className="w-10 h-10 mx-auto mb-3 text-ct-ink4" />
                    <p className="text-[13px] text-ct-ink3">Failed to load screenshot data.</p>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </Panel>
  )
}
