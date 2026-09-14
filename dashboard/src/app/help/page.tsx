'use client'

import { useState, useMemo } from 'react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import { SectionHead, Panel, PanelHead, Eyebrow, StatusPill } from '@/components/ct/primitives'
import { PlayCircle, Search, X, Clock } from 'lucide-react'

// Each tile represents one ~30-second walk-through the operator can watch
// instead of asking for a training session. Videos are Remotion renders
// with an edge-tts voiceover, published as static MP4s under
// /help/videos/{slug}.mp4. Tiles whose video hasn't been rendered yet
// show a "Coming soon" chip but stay in the grid so the shape of the
// help library is legible from day one.
interface HelpTopic {
  slug: string
  title: string
  category: 'Getting started' | 'Users' | 'Devices' | 'Forensic vault' | 'Content' | 'Observability'
  duration: number  // seconds
  description: string
  video?: string    // if unset, tile renders "coming soon"
}

const TOPICS: HelpTopic[] = [
  { slug: 'command-centre',    category: 'Getting started', duration: 30, title: 'Read the Command Centre',                  description: 'Every KPI on the home page and how the numbers relate to each other.', video: '/help/videos/command-centre.mp4' },
  { slug: 'kpi-gap',           category: 'Getting started', duration: 30, title: 'KPIs · why 1,000 vs 941',                  description: 'Why the top-line event count is larger than the Activity Breakdown sum.', video: '/help/videos/kpi-gap.mp4' },
  { slug: 'header-search',     category: 'Getting started', duration: 30, title: 'Search across the fleet',                  description: 'Use the header search to jump to any endpoint, event, keyword or IP.', video: '/help/videos/header-search.mp4' },
  { slug: 'create-user',       category: 'Users',           duration: 30, title: 'Create a user + hand off password',        description: 'Invite an analyst, show them their one-time temporary password, force reset on first login.', video: '/help/videos/create-user.mp4' },
  { slug: 'manage-user',       category: 'Users',           duration: 30, title: 'Suspend or delete a user',                 description: 'Revoke access without losing the audit trail; hard-delete when they leave.' },
  { slug: 'reset-password',    category: 'Users',           duration: 30, title: 'Reset your password',                      description: 'Change your own credential from the reset-password screen after must-change.', video: '/help/videos/reset-password.mp4' },
  { slug: 'audit-trail',       category: 'Users',           duration: 30, title: 'Read the audit trail',                     description: 'Filter by action, actor, or time window. Read who did what by email.', video: '/help/videos/audit-trail.mp4' },
  { slug: 'deployment-token',  category: 'Devices',         duration: 30, title: 'Generate a token + enrol a device',        description: 'Mint a short-lived deployment token and paste it into the MSI on the endpoint.', video: '/help/videos/deployment-token.mp4' },
  { slug: 'uploader-stalled',  category: 'Devices',         duration: 30, title: 'What "Uploader stalled" means',            description: 'How to spot devices that heartbeat but stop sending events, and what to try next.', video: '/help/videos/uploader-stalled.mp4' },
  { slug: 'vault-freshness',   category: 'Forensic vault',  duration: 30, title: 'Check an endpoint’s bundle status',   description: 'Use the Forensic Vault freshness panel to see which devices are overdue for an archive.', video: '/help/videos/vault-freshness.mp4' },
  { slug: 'request-archive',   category: 'Forensic vault',  duration: 30, title: 'Request + download an archive',            description: 'Trigger a fresh bundle on demand and use the burn-after-reading download flow.', video: '/help/videos/request-archive.mp4' },
  { slug: 'keywords',          category: 'Content',         duration: 30, title: 'Add or remove a sensitive keyword',        description: 'Extend the OCR watch list; retroactive rescan re-evaluates every existing screenshot.', video: '/help/videos/keywords.mp4' },
  { slug: 'critical-items',    category: 'Content',         duration: 30, title: 'Read the Critical items feed',             description: 'Understand why an image was flagged, which keywords matched, and what to do next.', video: '/help/videos/critical-items.mp4' },
  { slug: 'dedup',             category: 'Observability',   duration: 30, title: 'Near-duplicate screenshot suppression',    description: 'Why the same screen for hours only shows a handful of thumbnails, and how to see the count of suppressed frames.', video: '/help/videos/dedup.mp4' },
]

const CATEGORIES = ['Getting started', 'Users', 'Devices', 'Forensic vault', 'Content', 'Observability'] as const

function Tile({ topic, onOpen }: { topic: HelpTopic; onOpen: (t: HelpTopic) => void }) {
  const ready = !!topic.video
  return (
    <button
      onClick={() => ready && onOpen(topic)}
      disabled={!ready}
      className="text-left rounded-[3px] overflow-hidden border border-ct-line bg-ct-panel transition-colors hover:border-ct-accent-border hover:bg-ct-panel-hi disabled:cursor-not-allowed disabled:opacity-70"
    >
      {/* Video thumbnail placeholder / poster */}
      <div
        className="relative aspect-video"
        style={{
          background: `linear-gradient(135deg, var(--ct-bg2) 0%, var(--ct-panel-hi) 100%)`,
          borderBottom: '1px solid var(--ct-line)',
        }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          {ready ? (
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'var(--ct-accent-soft)', border: '1px solid var(--ct-accent-border)' }}
            >
              <PlayCircle className="w-6 h-6 text-ct-accent" />
            </div>
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'var(--ct-bg)', border: '1px dashed var(--ct-line2)' }}
            >
              <Clock className="w-4 h-4 text-ct-ink3" />
            </div>
          )}
        </div>
        <div
          className="absolute top-2 left-2 font-mono text-[10px] uppercase text-ct-ink3 px-2 py-0.5 rounded"
          style={{ background: 'rgba(0,0,0,0.5)', letterSpacing: '0.14em', backdropFilter: 'blur(4px)' }}
        >
          {topic.duration}s
        </div>
        {!ready && (
          <div className="absolute top-2 right-2">
            <StatusPill tone="idle" dot={false}>Coming soon</StatusPill>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="text-[13px] font-medium text-ct-ink mb-1 leading-snug">{topic.title}</div>
        <div className="text-[11px] text-ct-ink3 leading-relaxed" style={{ letterSpacing: '0.02em' }}>
          {topic.description}
        </div>
      </div>
    </button>
  )
}

function VideoModal({ topic, onClose }: { topic: HelpTopic; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-[3px] overflow-hidden"
        style={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-line2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-ct-line bg-ct-bg2">
          <div>
            <div className="text-[13px] font-medium text-ct-ink">{topic.title}</div>
            <Eyebrow className="mt-1">{topic.category} · {topic.duration} s</Eyebrow>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-sm text-ct-ink3 hover:text-ct-ink"
            style={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-line2)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <video
          key={topic.slug}
          src={topic.video}
          controls
          autoPlay
          className="w-full"
          style={{ background: '#000', maxHeight: '80vh' }}
        />
        <div className="p-4 text-[12px] text-ct-ink2 leading-relaxed">{topic.description}</div>
      </div>
    </div>
  )
}

export default function HelpPage() {
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<HelpTopic | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return TOPICS
    const q = search.toLowerCase()
    return TOPICS.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q),
    )
  }, [search])

  const ready = TOPICS.filter((t) => t.video).length

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />

        <main className="flex-1 overflow-auto p-8 mt-20 space-y-6">
          <SectionHead
            eyebrow={`Onboarding · ${ready} of ${TOPICS.length} walk-throughs available`}
            title="Help"
            right={
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ct-ink3" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search topics…"
                  className="w-full pl-9 pr-3 py-[7px] rounded-sm text-[12px] font-mono text-ct-ink placeholder:text-ct-ink3 focus:outline-none"
                  style={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-line2)' }}
                />
              </div>
            }
          />
          <p className="text-ct-ink3 text-[13px] -mt-2 max-w-3xl">
            30-second walk-throughs showing exactly how to do each task on the
            dashboard. Aimed at new operators so you can hand this out instead of
            running the same training call twice.
          </p>

          {CATEGORIES.map((cat) => {
            const catTopics = filtered.filter((t) => t.category === cat)
            if (catTopics.length === 0) return null
            return (
              <Panel key={cat}>
                <PanelHead title={cat} meta={`${catTopics.length} walk-through${catTopics.length === 1 ? '' : 's'}`} />
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {catTopics.map((topic) => (
                    <Tile key={topic.slug} topic={topic} onOpen={setActive} />
                  ))}
                </div>
              </Panel>
            )
          })}

          {filtered.length === 0 && (
            <div className="text-center py-16 rounded-sm border border-dashed border-ct-line bg-ct-bg2">
              <p className="text-[13px] text-ct-ink2">No topics match &ldquo;{search}&rdquo;.</p>
            </div>
          )}
        </main>
      </div>
      {active && <VideoModal topic={active} onClose={() => setActive(null)} />}
    </div>
  )
}
