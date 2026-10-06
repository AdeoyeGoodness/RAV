'use client'
import React, { useState, useEffect } from 'react'
import { Mail, Lock, Save, ShieldAlert, CheckCircle2, Server, UserCheck, XCircle, RefreshCw } from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import ExpiryBanner from '@/components/ExpiryBanner'
import ArchiveBanner from '@/components/ArchiveBanner'
import NextArchiveBanner from '@/components/NextArchiveBanner'
import { Panel, PanelHead, SectionHead, Eyebrow, ActionButton } from '@/components/ct/primitives'

export default function NotificationSettings() {
  const [settings, setSettings] = useState({
    smtp_host: '',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: '',
    smtp_from_email: '',
    smtp_enabled: false
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<'edit' | 'save' | 'discard' | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/org/settings`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('rav_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({
          ...data,
          smtp_password: '', // Never show hashed/encrypted password
          smtp_port: data.smtp_port || 587
        });
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const startVerification = (target: 'edit' | 'save' | 'discard') => {
    setVerifyTarget(target);
    setShowVerifyModal(true);
    setVerifyPassword('');
    setStatus(null);
  };

  const handleSaveAttempt = (e: React.FormEvent) => {
    e.preventDefault();
    startVerification('save');
  };

  const confirmAction = async () => {
    if (!verifyPassword) return;

    if (verifyTarget === 'edit') {
      await performVerificationOnly();
      return;
    }

    if (verifyTarget === 'discard') {
      await performVerificationOnly(() => {
        fetchSettings();
        setIsEditing(false);
      });
      return;
    }

    if (verifyTarget === 'save') {
      await performSave();
    }
  };

  const performVerificationOnly = async (onSuccess?: () => void) => {
    setIsSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/org/settings/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('rav_token')}`
        },
        body: JSON.stringify({ password: verifyPassword })
      });

      if (res.ok) {
        if (onSuccess) {
          onSuccess();
        } else {
          setIsEditing(true);
        }
        setShowVerifyModal(false);
        setVerifyPassword('');
      } else {
        setStatus({ type: 'error', msg: 'Identity verification failed.' });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: 'Network failure during verification.' });
    } finally {
      setIsSaving(false);
    }
  };

  const performSave = async () => {
    setIsSaving(true);
    setStatus(null);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/org/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('rav_token')}`
        },
        body: JSON.stringify({
          ...settings,
          verify_password: verifyPassword
        })
      });

      if (res.ok) {
        setStatus({ type: 'success', msg: 'Forensic Alert Settings updated successfully.' });
        setShowVerifyModal(false);
        setIsEditing(false);
        setVerifyPassword('');
        fetchSettings();
      } else {
        const err = await res.text();
        setStatus({ type: 'error', msg: err || 'Authentication failed or server error.' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setStatus(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/org/settings/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('rav_token')}`
        },
        body: JSON.stringify(settings)
      });

      if (res.ok) {
        setStatus({ type: 'success', msg: 'Verification alert dispatched. Please check your inbox.' });
      } else {
        const err = await res.text();
        setStatus({ type: 'error', msg: `SMTP Test Failed: ${err || 'Connection refused.'}` });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: 'Network failure. Ensure firewall allows outbound SMTP.' });
    } finally {
      setIsTesting(false);
    }
  };

  const inputBase = 'w-full bg-ct-bg2 border border-ct-line rounded-sm px-4 py-3 text-[13px] text-ct-ink font-mono placeholder:text-ct-ink4 focus:border-ct-accent-border outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className="flex h-screen bg-ct-bg text-ct-ink overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden ml-64">
        <Header />
        <ExpiryBanner />
        <ArchiveBanner />
        <NextArchiveBanner />
        <main className="flex-1 overflow-auto p-8 mt-20 space-y-6">
          <SectionHead
            eyebrow="Configuration / Alerts"
            title="Forensic Alert Gateways"
          />
          <p className="text-ct-ink3 text-[13px] -mt-2 max-w-3xl">
            Configure secure SMTP channels for automated archive notifications.
          </p>

          {status && (
            <div
              className="p-3 rounded-sm border flex items-center gap-3"
              style={{
                background: status.type === 'success' ? 'var(--ct-ok-soft)' : 'var(--ct-crit-soft)',
                borderColor: status.type === 'success' ? 'var(--ct-ok-border)' : 'var(--ct-crit-border)',
                color: status.type === 'success' ? 'var(--ct-ok)' : 'var(--ct-crit)',
              }}
            >
              {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
              <span className="text-[12px] font-medium">{status.msg}</span>
            </div>
          )}

          <form onSubmit={handleSaveAttempt} className="space-y-6">
            <Panel>
              <PanelHead
                title={
                  <span className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-ct-accent" />
                    Mail Server Configuration
                  </span>
                }
                right={
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={settings.smtp_enabled}
                      disabled={!isEditing}
                      onChange={(e) => setSettings({ ...settings, smtp_enabled: e.target.checked })}
                    />
                    <div
                      className={`w-9 h-5 rounded-sm border border-ct-line2 relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:rounded-[2px] after:h-3.5 after:w-3.5 after:transition-all peer-checked:after:translate-x-4 ${!isEditing ? 'opacity-50' : ''}`}
                      style={{
                        background: settings.smtp_enabled ? 'var(--ct-accent-soft)' : 'var(--ct-bg2)',
                        borderColor: settings.smtp_enabled ? 'var(--ct-accent-border)' : 'var(--ct-line2)',
                      }}
                    >
                      <span
                        className="absolute top-[2px] left-[2px] rounded-[2px] h-3.5 w-3.5 transition-all"
                        style={{
                          background: settings.smtp_enabled ? 'var(--ct-accent)' : 'var(--ct-ink3)',
                          transform: settings.smtp_enabled ? 'translateX(16px)' : 'translateX(0)',
                        }}
                      />
                    </div>
                    <span
                      className="ml-3 font-mono text-[10px] uppercase text-ct-ink3 font-medium"
                      style={{ letterSpacing: '0.18em' }}
                    >
                      Enable Alerts
                    </span>
                  </label>
                }
              />
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <Eyebrow className="mb-2">SMTP Host</Eyebrow>
                  <input
                    type="text"
                    value={settings.smtp_host || ''}
                    disabled={!isEditing}
                    onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
                    className={inputBase}
                    placeholder="smtp.gmail.com"
                  />
                </div>

                <div>
                  <Eyebrow className="mb-2">SMTP Port</Eyebrow>
                  <input
                    type="number"
                    value={settings.smtp_port}
                    disabled={!isEditing}
                    onChange={(e) => setSettings({ ...settings, smtp_port: parseInt(e.target.value) || 587 })}
                    className={inputBase}
                    placeholder="587"
                  />
                </div>

                <div className="md:col-span-2">
                  <Eyebrow className="mb-2">Sender Email</Eyebrow>
                  <input
                    type="email"
                    value={settings.smtp_from_email || ''}
                    disabled={!isEditing}
                    onChange={(e) => setSettings({ ...settings, smtp_from_email: e.target.value })}
                    className={inputBase}
                    placeholder="noreply@your-org.com"
                  />
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHead
                title={
                  <span className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-ct-accent" />
                    Secure Credentials
                  </span>
                }
              />
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <Eyebrow className="mb-2">SMTP Username</Eyebrow>
                  <input
                    type="text"
                    value={settings.smtp_username || ''}
                    disabled={!isEditing}
                    onChange={(e) => setSettings({ ...settings, smtp_username: e.target.value })}
                    className={inputBase}
                    placeholder="apikey"
                  />
                </div>

                <div>
                  <Eyebrow className="mb-2">SMTP Password</Eyebrow>
                  <input
                    type="password"
                    value={settings.smtp_password}
                    disabled={!isEditing}
                    autoComplete="new-password"
                    onChange={(e) => setSettings({ ...settings, smtp_password: e.target.value })}
                    className={inputBase}
                    placeholder="••••••••••••"
                  />
                </div>
              </div>
            </Panel>

            {isEditing && (
              <div
                className="flex items-center gap-4 p-4 rounded-sm border"
                style={{ background: 'var(--ct-accent-soft)', borderColor: 'var(--ct-accent-border)' }}
              >
                <div className="flex-1">
                  <Eyebrow>Gateway Validation</Eyebrow>
                  <p className="text-[12px] text-ct-ink2 mt-1">
                    Verify your configuration before locking the vault.
                  </p>
                </div>
                <ActionButton onClick={handleTestConnection} disabled={isTesting} variant="primary">
                  <span className="inline-flex items-center gap-2">
                    {isTesting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                    {isTesting ? 'Verifying…' : 'Push Test Alert'}
                  </span>
                </ActionButton>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              {isEditing ? (
                <>
                  <ActionButton onClick={() => startVerification('discard')} variant="danger">
                    <span className="inline-flex items-center gap-2">
                      <XCircle className="w-3 h-3" />
                      Discard Changes
                    </span>
                  </ActionButton>
                  <ActionButton type="submit" disabled={isSaving} variant="primary">
                    <span className="inline-flex items-center gap-2">
                      <Save className="w-3 h-3" />
                      {isSaving ? 'Authorizing…' : 'Save Vault Configuration'}
                    </span>
                  </ActionButton>
                </>
              ) : (
                <ActionButton onClick={() => startVerification('edit')} variant="ghost">
                  <span className="inline-flex items-center gap-2">
                    <Lock className="w-3 h-3" />
                    Unlock &amp; Edit Gateway
                  </span>
                </ActionButton>
              )}
            </div>
          </form>
        </main>

        {showVerifyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ct-bg/85 backdrop-blur-sm">
            <Panel className="w-full max-w-md">
              <PanelHead
                title={
                  <span className="flex items-center gap-2 text-ct-crit">
                    <ShieldAlert className="w-4 h-4" />
                    Identity Re-verification
                  </span>
                }
              />
              <div className="p-6 space-y-5">
                <p className="text-[13px] text-ct-ink2 leading-relaxed">
                  {verifyTarget === 'discard'
                    ? "Are you sure you want to discard your changes? Please verify your administrator identity to revert the gateway configuration."
                    : "Updating or unlocking your forensic alert gateways contains highly sensitive SMTP credentials. To proceed, please confirm your administrator identity."
                  }
                </p>

                <div>
                  <Eyebrow className="mb-2">Account Password</Eyebrow>
                  <input
                    type="password"
                    autoFocus
                    value={verifyPassword}
                    autoComplete="new-password"
                    onChange={(e) => setVerifyPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && confirmAction()}
                    className={inputBase}
                    placeholder="Enter your account password"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <ActionButton onClick={() => { setShowVerifyModal(false); setVerifyPassword(''); }} variant="ghost" className="flex-1">
                    Go Back
                  </ActionButton>
                  <ActionButton onClick={confirmAction} disabled={isSaving || !verifyPassword} variant="danger" className="flex-[2]">
                    {isSaving ? (
                      <span className="inline-flex items-center gap-2">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Authorizing…
                      </span>
                    ) : 'Authorize Action'}
                  </ActionButton>
                </div>
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  )
}
