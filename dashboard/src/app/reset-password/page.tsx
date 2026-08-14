'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { changePassword } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Panel, ActionButton, Eyebrow } from '@/components/ct/primitives'

export default function ResetPasswordPage() {
  const router = useRouter()
  const { user } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const validatePassword = (pass: string) => {
    if (pass.length < 8) return "Password must be at least 8 characters long."
    // We can add more complexity requirements here if needed
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please fill in all fields.")
      return
    }

    if (currentPassword === newPassword) {
      setError("New password cannot be the same as the current password.")
      return
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.")
      return
    }

    const validationError = validatePassword(newPassword)
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword
      })

      setSuccess(true)
      // Wait a moment for UX, then reload the page so AuthContext fetches the updated user
      // without the must_change_password flag, which will automatically redirect them home.
      setTimeout(() => {
        window.location.href = '/'
      }, 1500)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to change password. Please verify your current password is correct.')
      setLoading(false)
    }
  }

  // Double-check protection: if they are somehow here but don't need a reset, don't show the form.
  if (user && !user.must_change_password && !success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ct-bg">
        <div className="text-ct-ink text-[13px]">You do not need to change your password. Redirecting...</div>
      </div>
    )
  }

  const inputBase = 'block w-full px-4 py-3 bg-ct-bg2 border border-ct-line rounded-sm text-ct-ink placeholder:text-ct-ink4 text-[13px] font-mono focus:border-ct-accent-border outline-none transition-colors disabled:opacity-50'

  return (
    <div className="min-h-screen flex items-center justify-center bg-ct-bg px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <Panel>
          <div className="p-8 space-y-6">
            <div className="text-center">
              <div className="mx-auto w-11 h-11 rounded-sm flex items-center justify-center border border-ct-accent-border" style={{ background: 'var(--ct-accent-soft)' }}>
                <Lock className="w-5 h-5 text-ct-accent" />
              </div>
              <Eyebrow className="mt-4">Credential Rotation</Eyebrow>
              <h2 className="mt-2 text-[20px] font-semibold text-ct-ink" style={{ letterSpacing: '-0.005em' }}>
                Update Required
              </h2>
              <p className="mt-2 text-[13px] text-ct-ink3">
                For security reasons, you must change your temporary password before accessing the platform.
              </p>
            </div>

            {error && (
              <div
                className="rounded-sm p-3 flex items-start gap-2 border"
                style={{ background: 'var(--ct-crit-soft)', borderColor: 'var(--ct-crit-border)' }}
              >
                <AlertCircle className="w-4 h-4 text-ct-crit shrink-0 mt-0.5" />
                <p className="text-[12px] text-ct-crit">{error}</p>
              </div>
            )}

            {success && (
              <div
                className="rounded-sm p-3 flex items-start gap-2 border"
                style={{ background: 'var(--ct-ok-soft)', borderColor: 'var(--ct-ok-border)' }}
              >
                <CheckCircle2 className="w-4 h-4 text-ct-ok shrink-0 mt-0.5" />
                <p className="text-[12px] text-ct-ok">Password updated successfully. Redirecting...</p>
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <Eyebrow className="mb-2">Current Password</Eyebrow>
                  <input
                    type="password"
                    required
                    className={inputBase}
                    placeholder="Enter temporary password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={loading || success}
                  />
                </div>
                <div>
                  <Eyebrow className="mb-2">New Password</Eyebrow>
                  <input
                    type="password"
                    required
                    className={inputBase}
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={loading || success}
                  />
                </div>
                <div>
                  <Eyebrow className="mb-2">Confirm Password</Eyebrow>
                  <input
                    type="password"
                    required
                    className={inputBase}
                    placeholder="Repeat new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading || success}
                  />
                </div>
              </div>

              <ActionButton
                type="submit"
                disabled={loading || success}
                variant="primary"
                className="w-full py-3"
              >
                {loading ? 'Committing…' : 'Set Password'}
              </ActionButton>
            </form>
          </div>
        </Panel>
      </div>
    </div>
  )
}
