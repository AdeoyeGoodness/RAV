'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { changePassword } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react'

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
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-white">You do not need to change your password. Redirecting...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4 sm:px-6 lg:px-8 bg-grid-white/[0.02]">
      <div className="absolute inset-0 flex items-center justify-center bg-gray-950 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]"></div>
      
      <div className="max-w-md w-full space-y-8 relative z-10 p-8 bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl">
        <div>
          <div className="mx-auto w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20">
            <Lock className="w-6 h-6 text-blue-400" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white tracking-tight">
            Update Required
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            For security reasons, you must change your temporary password before accessing the platform.
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
            <p className="text-sm text-green-200">Password updated successfully! Redirecting...</p>
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Current Password</label>
              <input
                type="password"
                required
                className="block w-full px-4 py-3 bg-gray-950/50 border border-white/10 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-gray-500 transition-colors"
                placeholder="Enter temporary password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={loading || success}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">New Password</label>
              <input
                type="password"
                required
                className="block w-full px-4 py-3 bg-gray-950/50 border border-white/10 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-gray-500 transition-colors"
                placeholder="Must be at least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading || success}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Confirm Password</label>
              <input
                type="password"
                required
                className="block w-full px-4 py-3 bg-gray-950/50 border border-white/10 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-gray-500 transition-colors"
                placeholder="Repeat new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading || success}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || success}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 focus:ring-offset-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : "Set Password"}
          </button>
        </form>
      </div>
    </div>
  )
}
