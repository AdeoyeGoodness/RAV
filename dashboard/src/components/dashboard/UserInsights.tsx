'use client'

import { useAuth } from '@/contexts/AuthContext'
import { Panel, PanelHead, Eyebrow, StatusPill } from '../ct/primitives'

export function UserInsights() {
  const { user } = useAuth()
  const displayName = user?.email?.split('@')[0] || 'Operator'
  const roleDisplay = user?.role === 'super_admin' ? 'Super admin' : user?.role === 'org_admin' ? 'Org admin' : 'Analyst'
  const scope = user?.role === 'super_admin' ? 'Platform-wide' : 'Organization'

  return (
    <Panel className="h-full flex flex-col">
      <PanelHead title="Session" meta="Authenticated context" />

      {/* Identity */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-ct-line">
        <div
          className="w-11 h-11 rounded-[3px] flex items-center justify-center font-mono text-[15px] font-semibold text-ct-accent"
          style={{ background: 'var(--ct-accent-soft)', border: '1px solid var(--ct-accent-border)' }}
        >
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ct-ink truncate">{displayName}</div>
          <div
            className="font-mono text-[10px] text-ct-ink3 truncate mt-1"
            style={{ letterSpacing: '0.06em' }}
          >
            {user?.email || 'unknown@rav'}
          </div>
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1">
        <Row label="Role" value={roleDisplay} />
        <Row label="Scope" value={scope} />
        <Row label="Session" value={<StatusPill tone="ok">Active</StatusPill>} />
        <Row label="Origin" value="Web console" />
      </div>

      <div className="border-t border-ct-line px-5 py-3 flex items-center justify-between">
        <Eyebrow>RAV Platform</Eyebrow>
        <span className="font-mono text-[10px] text-ct-ink3 tabular-nums">v1.0.1</span>
      </div>
    </Panel>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-ct-line last:border-b-0">
      <Eyebrow>{label}</Eyebrow>
      <div className="text-[12px] text-ct-ink font-medium">{value}</div>
    </div>
  )
}
