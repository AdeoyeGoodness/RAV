'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns'

interface CalendarProps {
  events?: any[]
}

export default function Calendar({ events = [] }: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const today = new Date()

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd })
  
  // Get first day of month and last day of previous month for padding
  const firstDayOfWeek = monthStart.getDay()
  const lastDayOfPrevMonth = endOfMonth(subMonths(currentDate, 1))
  const prevMonthDays = Array.from({ length: firstDayOfWeek }, (_, i) => {
    const day = lastDayOfPrevMonth.getDate() - firstDayOfWeek + i + 1
    return new Date(lastDayOfPrevMonth.getFullYear(), lastDayOfPrevMonth.getMonth(), day)
  })

  const nextMonthStart = addMonths(currentDate, 1)
  const remainingDays = 42 - (prevMonthDays.length + daysInMonth.length)
  const nextMonthDays = Array.from({ length: remainingDays }, (_, i) => {
    return new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), i + 1)
  })

  const allDays = [...prevMonthDays, ...daysInMonth, ...nextMonthDays]

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const getEventsForDate = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.timestamp)
      return isSameDay(eventDate, date)
    }).length
  }

  const goToPreviousMonth = () => setCurrentDate(subMonths(currentDate, 1))
  const goToNextMonth = () => setCurrentDate(addMonths(currentDate, 1))

  return (
    <div className="bg-[#0F1629] border border-[#00D9FF]/20 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <button onClick={goToPreviousMonth} className="p-1 hover:bg-[#1A1F3A] rounded transition-colors">
          <ChevronLeft className="w-5 h-5 text-[#00D9FF]" />
        </button>
        <h3 className="text-lg font-semibold text-white">
          {format(currentDate, 'MMMM d, yyyy')}
        </h3>
        <button onClick={goToNextMonth} className="p-1 hover:bg-[#1A1F3A] rounded transition-colors">
          <ChevronRight className="w-5 h-5 text-[#00D9FF]" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map((day) => (
          <div key={day} className="text-center text-xs font-medium text-[#00D9FF]/70 py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {allDays.map((day, index) => {
          const isCurrentMonth = isSameMonth(day, currentDate)
          const isTodayDate = isSameDay(day, today)
          const isSelected = isSameDay(day, currentDate) && isCurrentMonth
          const eventCount = getEventsForDate(day)
          const hasEvent = eventCount > 0 && isCurrentMonth

          return (
            <div
              key={index}
              className={`
                aspect-square flex items-center justify-center text-sm rounded-lg
                ${!isCurrentMonth ? 'text-[#00D9FF]/30' : 'text-white'}
                ${isTodayDate && isCurrentMonth ? 'bg-[#00D9FF] text-[#0A0E27] font-semibold cyber-glow' : ''}
                ${isSelected && !isTodayDate ? 'bg-[#6C5CE7]/30 text-[#00D9FF] border border-[#00D9FF]/50' : ''}
                ${!isTodayDate && !isSelected && isCurrentMonth ? 'hover:bg-[#1A1F3A] hover:border hover:border-[#00D9FF]/30' : ''}
                relative transition-all
              `}
            >
              {day.getDate()}
              {hasEvent && !isTodayDate && (
                <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-[#00FF88] rounded-full"></div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

