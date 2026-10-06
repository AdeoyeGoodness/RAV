'use client'

import { useEffect, useState } from 'react'
import { UserPlus, Trash2, RefreshCw, Copy, Check, ShieldAlert, X, KeyRound, PauseCircle, PlayCircle, AlertCircle } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import NextArchiveBanner from '@/components/NextArchiveBanner'
import { formatWATDate } from '@/lib/time'
import {
  OrgUser,
  CreateOrgUserResponse,
  getOrgUsers,
  createOrgUser,
  setOrgUserStatus,
  resetOrgUserPassword,
  deleteOrgUser,
} from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Panel, PanelHead, SectionHead, StatusPill, ActionButton, Eyebrow } from '@/components/ct/primitives'

// One-time credentials hand-off modal — mirrors the shape used by the
// super-admin "Onboard Org" flow so an org_admin knows exactly what to
// hand to their new analyst. The plaintext password is never persisted
// after this modal is dismissed (server has only the bcrypt hash).
function CredentialsModal({
  creds,
  onClose,
}: {
  creds: { email: string; temporary_password: string }
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const handoff = `User: ${creds.email}\nTemporary password: ${creds.temporary_password}\n\nThey must sign in and change this password immediately.`

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-md rounded-[3px] p-6"
        style={{ background: 'var(--ct-panel)', border: '1px solid var(--ct-line2)' }}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-4 h-4 text-ct-accent" />
            <div>
              <div className="text-[14px] font-semibold text-ct-ink">Credentials hand-off</div>
              <Eyebrow className="mt-1">Reveal-once — copy now</Eyebrow>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ct-ink3 hover:text-ct-ink p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[12px] text-ct-ink2 mb-5 leading-relaxed">
          Give the temporary password to the new user out-of-band (chat, in
          person). On first login they&apos;ll be forced to set their own
          password before they can access the console.
        </p>

        <div
          className="p-3 rounded-sm mb-3 font-mono text-[12px]"
          style={{ background: 'var(--ct-bg)', border: '1px solid var(--ct-line2)' }}
        >
          <div className="text-ct-ink3 mb-1">USER</div>
          <div className="text-ct-ink mb-2 break-all">{creds.email}</div>
          <div className="text-ct-ink3 mb-1">TEMPORARY PASSWORD</div>
          <div className="text-ct-accent break-all tabular-nums">{creds.temporary_password}</div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              navigator.clipboard.writeText(handoff)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="flex-1 font-mono text-[11px] uppercase py-2 rounded-sm transition-colors flex items-center justify-center gap-2"
            style={{
              background: 'var(--ct-accent-soft)',
              border: '1px solid var(--ct-accent-border)',
              color: 'var(--ct-accent)',
              letterSpacing: '0.18em',
            }}
          >
            {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy hand-off</>}
          </button>
          <button
            onClick={onClose}
            className="flex-1 font-mono text-[11px] uppercase text-ct-ink2 py-2 rounded-sm transition-colors"
            style={{ background: 'transparent', border: '1px solid var(--ct-line2)', letterSpacing: '0.18em' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default function OrgUsersPage() {
  const { user, isLoading } = useAuth()
  const [rows, setRows] = useState<OrgUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [handOff, setHandOff] = useState<CreateOrgUserResponse | null>(null)

  const canManage = user?.role === 'org_admin' || user?.role === 'super_admin'

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getOrgUsers()
      setRows(data)
    } catch (e: any) {
      setError(e?.response?.status === 403 ? 'Not authorised.' : 'Unable to load users.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) load()
  }, [user])

  const submitCreate = async () => {
    const email = newEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setError('Enter a valid email.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const res = await createOrgUser({ email, full_name: newName.trim() || undefined })
      setHandOff(res)
      setNewEmail('')
      setNewName('')
      setShowCreate(false)
      await load()
    } catch (e: any) {
      setError(
        e?.response?.status === 409
          ? 'A user with that email already exists.'
          : e?.response?.status === 403
          ? 'Only org admins can create users.'
          : 'Failed to create user.',
      )
    } finally {
      setCreating(false)
    }
  }

  const toggleStatus = async (u: OrgUser) => {
    const next = u.status === 'active' ? 'suspended' : 'active'
    if (!confirm(`${next === 'suspended' ? 'Suspend' : 'Reactivate'} ${u.email}?`)) return
    try {
      await setOrgUserStatus(u.id, next)
      await load()
    } catch {
      setError('Failed to update user status.')
    }
  }

  const doReset = async (u: OrgUser) => {
    if (!confirm(`Regenerate a temporary password for ${u.email}? They will be forced to reset on next login.`)) return
    try {
      const res = await resetOrgUserPassword(u.id)
      setHandOff({ id: u.id, email: u.email, role: 'user', temporary_password: res.temporary_password })
      await load()
    } catch {
      setError('Failed to reset password.')
    }
  }

  const doDelete = async (u: OrgUser) => {
    if (!confirm(`Delete ${u.email}? This is permanent.`)) return
    try {
      await deleteOrgUser(u.id)
      await load()
    } catch {
      setError('Failed to delete user.')
    }
  }

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-ct-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full animate-spin"
            style={{ borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--ct-line2)', borderTopColor: 'var(--ct-accent)' }}
          />
          <span className="text-[10px] font-mono uppercase text-ct-ink3" style={{ letterSpacing: '0.24em' }}>
            Loading users
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />
        <NextArchiveBanner />

        <main className="flex-1 overflow-y-auto p-8 mt-20 space-y-6">
          <SectionHead
            eyebrow={`Access · ${rows.length} user${rows.length === 1 ? '' : 's'} · ${rows.filter((u) => u.role === 'org_admin').length} admin${rows.filter((u) => u.role === 'org_admin').length === 1 ? '' : 's'}`}
            title="Users"
            right={
              canManage && (
                <ActionButton onClick={() => setShowCreate((v) => !v)}>
                  <UserPlus className="w-3 h-3 inline mr-2" />
                  {showCreate ? 'Cancel' : 'Invite user'}
                </ActionButton>
              )
            }
          />

          {error && (
            <div
              className="flex items-center gap-2 p-3 rounded-sm text-[12px]"
              style={{
                background: 'var(--ct-crit-soft)',
                border: '1px solid var(--ct-crit-border)',
                color: 'var(--ct-crit)',
              }}
            >
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {showCreate && canManage && (
            <Panel>
              <PanelHead
                title="Invite user"
                meta="Read-only analyst — can view telemetry but cannot mutate anything."
              />
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <Eyebrow className="mb-2">Email</Eyebrow>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="analyst@company.com"
                      className="w-full px-3 py-[9px] rounded-sm text-[13px] font-mono text-ct-ink placeholder:text-ct-ink3 focus:outline-none"
                      style={{ background: 'var(--ct-bg2)', border: '1px solid var(--ct-line2)' }}
                    />
                  </div>
                  <div>
                    <Eyebrow className="mb-2">Full name · optional</Eyebrow>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Amina Diallo"
                      className="w-full px-3 py-[9px] rounded-sm text-[13px] font-mono text-ct-ink placeholder:text-ct-ink3 focus:outline-none"
                      style={{ background: 'var(--ct-bg2)', border: '1px solid var(--ct-line2)' }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ActionButton onClick={submitCreate} disabled={creating || !newEmail.trim()}>
                    {creating ? (
                      <><RefreshCw className="w-3 h-3 inline mr-2 animate-spin" /> Creating…</>
                    ) : (
                      <>Create user</>
                    )}
                  </ActionButton>
                  <span className="font-mono text-[11px] text-ct-ink3" style={{ letterSpacing: '0.04em' }}>
                    Temporary password is revealed once on the next screen — nowhere else.
                  </span>
                </div>
              </div>
            </Panel>
          )}

          <Panel padding={false}>
            <PanelHead title="Access roster" meta={`${rows.length} account${rows.length === 1 ? '' : 's'}`} />
            {loading ? (
              <div className="text-center py-10 text-[11px] text-ct-ink3 font-mono">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-center py-10 text-[11px] text-ct-ink3 font-mono">No users on record.</div>
            ) : (
              <ul className="divide-y divide-ct-line">
                {rows.map((u) => {
                  const isSelf = u.id === user?.id
                  const isAdmin = u.role === 'org_admin'
                  const canMutate = canManage && u.role === 'user' && !isSelf
                  return (
                    <li key={u.id} className="grid items-center gap-3 px-5 py-3" style={{ gridTemplateColumns: '1.6fr 100px 110px 130px 130px 220px' }}>
                      <div className="min-w-0">
                        <div className="text-[13px] text-ct-ink font-medium truncate">
                          {u.full_name || u.email}
                        </div>
                        <div className="font-mono text-[10px] text-ct-ink3 truncate mt-1" style={{ letterSpacing: '0.04em' }}>
                          {u.email}
                        </div>
                      </div>
                      <StatusPill tone={isAdmin ? 'accent' : 'idle'} dot={false}>
                        {isAdmin ? 'Org admin' : 'User'}
                      </StatusPill>
                      <StatusPill tone={u.status === 'active' ? 'ok' : 'warn'}>
                        {u.status}
                      </StatusPill>
                      {u.must_change_password ? (
                        <StatusPill tone="warn" dot={false}>Must reset</StatusPill>
                      ) : (
                        <span className="font-mono text-[10px] text-ct-ink3 tabular-nums">
                          {u.password_changed_at ? `pw ${formatWATDate(u.password_changed_at)}` : ''}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-ct-ink3 tabular-nums">
                        {formatWATDate(u.created_at)}
                      </span>
                      <div className="flex items-center gap-1 justify-end">
                        {canMutate && (
                          <>
                            <button
                              onClick={() => toggleStatus(u)}
                              className="p-1.5 rounded-sm text-ct-ink3 hover:text-ct-warn transition-colors"
                              title={u.status === 'active' ? 'Suspend' : 'Reactivate'}
                            >
                              {u.status === 'active' ? <PauseCircle className="w-3.5 h-3.5" /> : <PlayCircle className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => doReset(u)}
                              className="p-1.5 rounded-sm text-ct-ink3 hover:text-ct-accent transition-colors"
                              title="Regenerate temporary password"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => doDelete(u)}
                              className="p-1.5 rounded-sm text-ct-ink3 hover:text-ct-crit transition-colors"
                              title="Delete user"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {!canMutate && (
                          <span className="font-mono text-[10px] text-ct-ink4">
                            {isSelf ? '— self' : isAdmin ? '— admin' : ''}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </main>
      </div>
      {handOff && <CredentialsModal creds={handOff} onClose={() => setHandOff(null)} />}
    </div>
  )
}
