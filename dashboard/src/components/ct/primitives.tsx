'use client'

import React from 'react'

// Command Terminal — shared UI primitives.
// Every dashboard component pulls from these so the visual language stays
// tight: near-black ground, steel-blue accent, mono numerics, hairline dividers.

type StatusTone = 'ok' | 'warn' | 'crit' | 'accent' | 'idle' | 'gold'

const toneMap: Record<StatusTone, { color: string; bg: string; border: string; dot: string }> = {
  ok:     { color: 'var(--ct-ok)',    bg: 'var(--ct-ok-soft)',    border: 'var(--ct-ok-border)',    dot: 'var(--ct-ok)' },
  warn:   { color: 'var(--ct-warn)',  bg: 'var(--ct-warn-soft)',  border: 'var(--ct-warn-border)',  dot: 'var(--ct-warn)' },
  crit:   { color: 'var(--ct-crit)',  bg: 'var(--ct-crit-soft)',  border: 'var(--ct-crit-border)',  dot: 'var(--ct-crit)' },
  accent: { color: 'var(--ct-accent)', bg: 'var(--ct-accent-soft)', border: 'var(--ct-accent-border)', dot: 'var(--ct-accent)' },
  gold:   { color: 'var(--ct-gold)',  bg: 'rgba(200,162,83,0.08)', border: 'rgba(200,162,83,0.30)', dot: 'var(--ct-gold)' },
  idle:   { color: 'var(--ct-ink3)',  bg: 'var(--ct-bg2)',         border: 'var(--ct-line2)',         dot: 'var(--ct-ink4)' },
}

/** Uppercase, letter-spaced label used above numbers and section headings. */
export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`font-mono text-[10px] uppercase text-ct-ink3 font-medium ${className}`}
      style={{ letterSpacing: '0.22em' }}
    >
      {children}
    </div>
  )
}

/** Status pill with optional dot. */
export function StatusPill({ tone, children, dot = true }: { tone: StatusTone; children: React.ReactNode; dot?: boolean }) {
  const t = toneMap[tone]
  return (
    <span
      className="inline-flex items-center gap-2 rounded-sm font-mono text-[10px] font-medium uppercase"
      style={{
        color: t.color,
        background: t.bg,
        border: `1px solid ${t.border}`,
        padding: '3px 8px',
        letterSpacing: '0.14em',
      }}
    >
      {dot && <span className="w-[5px] h-[5px] rounded-full" style={{ background: t.dot }} />}
      {children}
    </span>
  )
}

/** Panel — bordered box with optional header. */
export function Panel({
  children,
  className = '',
  padding = true,
}: {
  children: React.ReactNode
  className?: string
  padding?: boolean
}) {
  return (
    <div
      className={`bg-ct-panel border border-ct-line rounded-[3px] overflow-hidden ${className}`}
      style={padding ? undefined : undefined}
    >
      {children}
    </div>
  )
}

export function PanelHead({
  title,
  meta,
  right,
  live,
}: {
  title: React.ReactNode
  meta?: React.ReactNode
  right?: React.ReactNode
  live?: boolean
}) {
  return (
    <div
      className="flex items-center justify-between bg-ct-bg2 border-b border-ct-line"
      style={{ padding: '14px 20px' }}
    >
      <div>
        <div className="text-[14px] font-semibold text-ct-ink" style={{ letterSpacing: '-0.005em' }}>
          {title}
        </div>
        {meta && <Eyebrow className="mt-1">{meta}</Eyebrow>}
      </div>
      <div className="flex items-center gap-3">
        {live && (
          <span className="inline-flex items-center gap-2">
            <span
              className="w-[6px] h-[6px] rounded-full animate-ct-pulse"
              style={{ background: 'var(--ct-ok)', boxShadow: '0 0 0 3px rgba(76,185,138,0.15)' }}
            />
            <span
              className="font-mono text-[10px] font-medium uppercase text-ct-ok"
              style={{ letterSpacing: '0.20em' }}
            >
              Live
            </span>
          </span>
        )}
        {right}
      </div>
    </div>
  )
}

/** Big stat cell used in fleet strips / KPI rows. */
export function Stat({
  label,
  value,
  sub,
  tone = 'ink',
  last,
  href,
  onClick,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'ink' | 'accent' | 'ok' | 'warn' | 'crit'
  last?: boolean
  href?: string
  onClick?: () => void
}) {
  const valueColor = {
    ink: 'var(--ct-ink)',
    accent: 'var(--ct-accent)',
    ok: 'var(--ct-ok)',
    warn: 'var(--ct-warn)',
    crit: 'var(--ct-crit)',
  }[tone]

  const inner = (
    <div
      className="transition-colors"
      style={{
        padding: '16px 20px',
        borderRight: last ? undefined : '1px solid var(--ct-line)',
        cursor: href || onClick ? 'pointer' : undefined,
      }}
      onClick={onClick}
    >
      <Eyebrow>{label}</Eyebrow>
      <div
        className="font-mono font-medium tabular-nums"
        style={{ fontSize: 30, color: valueColor, letterSpacing: '-0.01em', marginTop: 6 }}
      >
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[11px] text-ct-ink3 mt-1" style={{ letterSpacing: '0.06em' }}>
          {sub}
        </div>
      )}
    </div>
  )
  if (href) return <a href={href}>{inner}</a>
  return inner
}

/** Chip — used for keyword lists, filter tabs, campaign labels. */
export function Chip({
  children,
  tone = 'accent',
  active,
  onClick,
}: {
  children: React.ReactNode
  tone?: StatusTone
  active?: boolean
  onClick?: () => void
}) {
  const t = toneMap[tone]
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-sm font-mono text-[11px] font-medium uppercase transition-colors"
      style={{
        color: active ? t.color : 'var(--ct-ink2)',
        background: active ? t.bg : 'transparent',
        border: `1px solid ${active ? t.border : 'var(--ct-line2)'}`,
        padding: '5px 10px',
        letterSpacing: '0.16em',
      }}
    >
      {children}
    </button>
  )
}

/** Section divider heading — hairline rule + eyebrow label. */
export function SectionHead({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
        <h2 className="text-[22px] font-semibold text-ct-ink" style={{ letterSpacing: '-0.005em' }}>
          {title}
        </h2>
      </div>
      {right}
    </div>
  )
}

/** Primary command button. */
export function ActionButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
  className = '',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost' | 'danger'
  type?: 'button' | 'submit'
  className?: string
}) {
  const styles: React.CSSProperties =
    variant === 'primary'
      ? {
          color: 'var(--ct-accent)',
          background: 'var(--ct-accent-soft)',
          border: '1px solid var(--ct-accent-border)',
        }
      : variant === 'danger'
      ? {
          color: 'var(--ct-crit)',
          background: 'var(--ct-crit-soft)',
          border: '1px solid var(--ct-crit-border)',
        }
      : {
          color: 'var(--ct-ink2)',
          background: 'transparent',
          border: '1px solid var(--ct-line2)',
        }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`font-mono text-[11px] font-medium uppercase rounded-sm px-3 py-[7px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-125 ${className}`}
      style={{ ...styles, letterSpacing: '0.18em' }}
    >
      {children}
    </button>
  )
}
