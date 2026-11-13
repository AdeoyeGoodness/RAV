/**
 * Forensic time resolution for events.
 *
 * Every event carries TWO clocks, and they are not interchangeable:
 *
 *  - `timestamp`   — endpoint-reported ("captured_at"): what the monitored
 *                    device's OWN clock claimed at capture. It is drift-exposed
 *                    and, on a box with a local admin, attacker-controllable —
 *                    someone can roll their clock to make an event appear to
 *                    happen last week, in the future, or out of order.
 *  - `received_at` — server-received: stamped by the backend (column DEFAULT
 *                    NOW()) the moment the event arrived. It is the one clock the
 *                    monitored user cannot touch, and the only common reference
 *                    that lets events from different endpoints be ordered against
 *                    each other.
 *
 * So the authoritative forensic timeline — what we SORT by and show as the
 * primary time — is SERVER time. The endpoint-reported time is preserved and
 * surfaced alongside, never discarded: the gap between the two is itself
 * evidence (a misconfigured clock, or a deliberately manipulated one).
 *
 * Note: server-received time is a "no later than" bound — an agent that buffered
 * while offline delivers late — so it is labelled "received", not "occurred".
 */

import type { Event } from './api'

type TimeInput = string | number | Date | null | undefined
type EventTimes = Pick<Event, 'timestamp'> & {
  received_at?: string | null
  created_at?: string | null
}

function ms(v: TimeInput): number | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  const t = d.getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Server-received time — authoritative for ordering and primary display.
 * Falls back to created_at, then (last resort) the endpoint timestamp so a row
 * with no server time at all still renders something rather than "—".
 */
export function eventServerTime(e: EventTimes): string | null {
  return e.received_at || e.created_at || e.timestamp || null
}

/** Endpoint-reported time — what the device's own clock claimed. Evidence, not authority. */
export function eventEndpointTime(e: EventTimes): string | null {
  return e.timestamp || null
}

/** Epoch ms on the authoritative (server) clock — use this as the sort key. */
export function eventServerMs(e: EventTimes): number {
  return ms(eventServerTime(e)) ?? 0
}

/**
 * endpoint − server, in whole seconds.
 * Positive  = the endpoint clock is running AHEAD of the server (events claim to
 *             be in the future). Negative = running BEHIND. null = unknowable.
 */
export function eventSkewSeconds(e: EventTimes): number | null {
  const srv = ms(eventServerTime(e))
  const end = ms(eventEndpointTime(e))
  if (srv === null || end === null) return null
  return Math.round((end - srv) / 1000)
}

/** Default tolerance before a divergence is worth flagging (network + batching noise). */
export const SKEW_THRESHOLD_SEC = 120

/** True when the endpoint clock diverges from the server by more than the threshold. */
export function eventHasSkew(e: EventTimes, thresholdSec = SKEW_THRESHOLD_SEC): boolean {
  const s = eventSkewSeconds(e)
  return s !== null && Math.abs(s) > thresholdSec
}

/**
 * Human label for a flagged skew, e.g. "1h ahead", "3m behind", "45s ahead".
 * Returns '' when within threshold or unknown (so callers can `{label && ...}`).
 */
export function formatSkew(e: EventTimes, thresholdSec = SKEW_THRESHOLD_SEC): string {
  const s = eventSkewSeconds(e)
  if (s === null || Math.abs(s) <= thresholdSec) return ''
  const ahead = s > 0
  let a = Math.abs(s)
  const h = Math.floor(a / 3600)
  a -= h * 3600
  const m = Math.floor(a / 60)
  const sec = a - m * 60
  const parts: string[] = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (!h && !m) parts.push(`${sec}s`)
  return `${parts.join(' ')} ${ahead ? 'ahead' : 'behind'}`
}
