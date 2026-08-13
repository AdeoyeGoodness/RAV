'use client'

import { isToday, isTomorrow, formatDistanceToNow } from 'date-fns'
import { formatWATPattern } from '@/lib/time'
import { CheckCircle2, Circle, AlertCircle, Activity } from 'lucide-react'

interface Event {
  id: string
  event_type: string
  timestamp: string
  agent_id: string
  metadata?: any
}

interface RecentTasksProps {
  events: Event[]
  loading: boolean
}

export default function RecentTasks({ events, loading }: RecentTasksProps) {
  const getTaskDate = (timestamp: string) => {
    const date = new Date(timestamp)
    if (isToday(date)) return 'Today'
    if (isTomorrow(date)) return 'Tomorrow'
    return formatWATPattern(date, 'MMM d')
  }

  const getEventIcon = (eventType: string) => {
    if (eventType.includes('usb') || eventType.includes('USB')) {
      return <Activity className="w-4 h-4 text-[#00D9FF]" />
    }
    if (eventType.includes('network') || eventType.includes('Network')) {
      return <AlertCircle className="w-4 h-4 text-[#00FF88]" />
    }
    return <Circle className="w-4 h-4 text-[#6C5CE7]" />
  }

  const formatEventName = (eventType: string) => {
    return eventType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
  }

  const recentEvents = events.slice(0, 4)

  if (loading) {
    return (
      <div className="bg-[#0F1629] border border-[#00D9FF]/20 rounded-2xl p-6">
        <p className="text-[#00D9FF]/60">Loading events...</p>
      </div>
    )
  }

  return (
    <div className="bg-[#0F1629] border border-[#00D9FF]/20 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Recent Events</h2>
        <a href="#" className="text-sm text-[#00D9FF] hover:text-[#00FF88] transition-colors">View All</a>
      </div>
      <div className="space-y-3">
        {recentEvents.length === 0 ? (
          <p className="text-[#00D9FF]/60 text-sm">No recent events</p>
        ) : (
          recentEvents.map((event, index) => {
            const isProcessed = index === 1 || new Date(event.timestamp) < new Date(Date.now() - 60000)
            return (
              <div key={event.id} className="flex items-center justify-between p-3 hover:bg-[#1A1F3A] rounded-lg border border-[#00D9FF]/10 transition-all">
                <div className="flex items-center space-x-3 flex-1">
                  {isProcessed ? (
                    <CheckCircle2 className="w-5 h-5 text-[#00FF88]" />
                  ) : (
                    <Circle className="w-5 h-5 text-[#00D9FF]/40" />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      {getEventIcon(event.event_type)}
                      <p className="text-sm font-medium text-white">
                        {formatEventName(event.event_type)}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-xs text-[#00D9FF]/70">{getTaskDate(event.timestamp)}</span>
                      <span className="text-xs text-[#00D9FF]/50">•</span>
                      <span className="text-xs text-[#00D9FF]/70">{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}</span>
                      <div className="flex -space-x-1 ml-2">
                        <div className="w-5 h-5 bg-gradient-to-br from-[#00D9FF] to-[#6C5CE7] rounded-full border-2 border-[#0F1629]"></div>
                        <div className="w-5 h-5 bg-gradient-to-br from-[#00FF88] to-[#00D9FF] rounded-full border-2 border-[#0F1629]"></div>
                      </div>
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

