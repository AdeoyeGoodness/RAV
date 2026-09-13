'use client'

import { useEffect, useRef, useState } from 'react'

interface CounterProps {
  /** Target value. Component animates from whatever it currently shows to this. */
  value: number
  /**
   * Animation duration in ms. Defaults to 1600ms — deliberate ticker feel,
   * slow enough that the eye follows the count instead of missing it.
   */
  duration?: number
  /**
   * Custom formatter. Defaults to `Math.round(n).toLocaleString()` — always
   * shows a rounded integer with thousands separators, which is what every
   * KPI on the dashboard needs.
   */
  format?: (n: number) => string
  /**
   * If the target changes mid-animation, whether to smoothly retarget (true)
   * or snap and re-animate from the current interpolated value. Default true.
   */
  smooth?: boolean
}

/**
 * Animated number counter — used across the Command Centre + Devices fleet
 * strip so KPIs animate up when they first land (initial load) and glide
 * between values when the polled summary refreshes (live ticker feel).
 *
 * Runs on requestAnimationFrame with an ease-out cubic so the number
 * decelerates as it approaches the target, matching the vibe of a
 * stock-ticker rather than a mechanical odometer.
 */
export function Counter({
  value,
  duration = 1600,
  format = (n) => Math.round(n).toLocaleString(),
}: CounterProps) {
  const [display, setDisplay] = useState<number>(0)

  useEffect(() => {
    // Capture the "from" once at effect run — deliberately stale so an
    // in-flight animation smoothly re-targets from wherever it currently
    // is, instead of snapping back to 0.
    let from = display
    const to = value
    if (from === to) return

    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const elapsed = t - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(from + (to - from) * eased)
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  return <>{format(display)}</>
}
