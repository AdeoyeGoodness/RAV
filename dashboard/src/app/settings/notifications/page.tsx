'use client'
import React, { useState, useEffect } from 'react'
import { Mail, ShieldCheck, Lock, Save, AlertCircle, ShieldAlert, CheckCircle2, Server, Hash, UserCheck } from 'lucide-react'
import Sidebar from '@/components/Sidebar'

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
  const [verifyPassword, setVerifyPassword] = useState('');
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

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

  const handleSaveAttempt = (e: React.FormEvent) => {
    e.preventDefault();
    setShowVerifyModal(true);
  };

  const confirmSave = async () => {
    if (!verifyPassword) return;
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
        setVerifyPassword('');
        fetchSettings();
      } else {
        const err = await res.text();
        setStatus({ type: 'error', msg: err || 'Authentication failed or server error.' });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: 'Network failure. Could not connect to gateway.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#050510] text-slate-300">
      <Sidebar />
      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <header className="mb-10">
            <div className="flex items-center gap-4 mb-3">
              <div className="bg-sky-500/10 p-3 rounded-2xl">
                <ShieldCheck className="w-8 h-8 text-sky-400" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white tracking-tight">Forensic alert gateways</h1>
                <p className="text-slate-500 text-sm mt-1">Configure secure SMTP channels for automated archive notifications.</p>
              </div>
            </div>
          </header>

          {status && (
            <div className={`mb-8 p-4 rounded-xl border flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${
              status.type === 'success' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/5 border-rose-500/20 text-rose-400'
            }`}>
              {status.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
              <span className="text-sm font-medium">{status.msg}</span>
            </div>
          )}

          <form onSubmit={handleSaveAttempt} className="space-y-6">
            <section className="bg-[#0C0E1C] border border-white/[0.06] rounded-2x p-8">
               <div className="flex items-center justify-between mb-8">
                 <div className="flex items-center gap-2">
                   <Server className="w-5 h-5 text-slate-500" />
                   <h2 className="text-xl font-bold text-slate-200">Mail Server Configuration</h2>
                 </div>
                 <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={settings.smtp_enabled}
                      onChange={(e) => setSettings({...settings, smtp_enabled: e.target.checked})}
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                    <span className="ml-3 text-sm font-bold text-slate-400 uppercase tracking-widest">Enable Alerts</span>
                  </label>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">SMTP Host</label>
                    <div className="relative group">
                       <input 
                         type="text" 
                         value={settings.smtp_host || ''} 
                         onChange={(e) => setSettings({...settings, smtp_host: e.target.value})}
                         className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white focus:border-sky-500/50 outline-none transition-all"
                         placeholder="smtp.gmail.com"
                       />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">SMTP Port</label>
                    <div className="relative group">
                       <input 
                         type="number" 
                         value={settings.smtp_port} 
                         onChange={(e) => setSettings({...settings, smtp_port: parseInt(e.target.value)})}
                         className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white focus:border-sky-500/50 outline-none transition-all"
                         placeholder="587"
                       />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Sender Email</label>
                    <div className="relative group">
                       <input 
                         type="email" 
                         value={settings.smtp_from_email || ''} 
                         onChange={(e) => setSettings({...settings, smtp_from_email: e.target.value})}
                         className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white focus:border-sky-500/50 outline-none transition-all"
                         placeholder="noreply@your-org.com"
                       />
                    </div>
                  </div>
               </div>
            </section>

            <section className="bg-[#0C0E1C] border border-white/[0.06] rounded-2xl p-8 relative overflow-hidden">
               <div className="absolute top-0 right-0 p-4 opacity-5">
                 <Lock className="w-32 h-32 text-white" />
               </div>
               
               <div className="flex items-center gap-2 mb-8">
                 <UserCheck className="w-5 h-5 text-slate-500" />
                 <h2 className="text-xl font-bold text-slate-200">Secure Credentials</h2>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">SMTP Username</label>
                    <input 
                      type="text" 
                      value={settings.smtp_username || ''} 
                      onChange={(e) => setSettings({...settings, smtp_username: e.target.value})}
                      className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white focus:border-sky-500/50 outline-none transition-all"
                      placeholder="apikey"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">SMTP Password</label>
                    <input 
                      type="password" 
                      value={settings.smtp_password} 
                      onChange={(e) => setSettings({...settings, smtp_password: e.target.value})}
                      className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white focus:border-sky-500/50 outline-none transition-all"
                      placeholder="••••••••••••"
                    />
                  </div>
               </div>
            </section>

            <div className="flex justify-end gap-4 pt-4">
               <button 
                 type="button"
                 onClick={() => window.location.href = '/'}
                 className="px-8 py-3 rounded-xl border border-white/[0.06] text-slate-400 font-bold text-sm hover:bg-white/[0.02] transition-all"
               >
                 Discard
               </button>
               <button 
                 type="submit"
                 disabled={isSaving}
                 className="px-10 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-black font-bold text-sm transition-all shadow-lg shadow-sky-500/20 flex items-center gap-2 disabled:opacity-50"
               >
                 <Save className="w-4 h-4" />
                 {isSaving ? 'Encrypting...' : 'Save Vault Configuration'}
               </button>
            </div>
          </form>
        </div>
      </main>

      {showVerifyModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#0C0E1C] border border-white/10 p-8 rounded-3xl w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
              <ShieldAlert className="w-8 h-8 text-rose-500" />
              <h3 className="text-xl font-bold text-white">Identity re-verification</h3>
            </div>
            
            <p className="text-sm text-slate-400 mb-8 leading-relaxed">
              Updating your forensic alert gateways contains highly sensitive SMTP credentials. To proceed, please confirm your administrator identity.
            </p>

            <div className="space-y-2 mb-8">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">Account Password</label>
              <div className="relative">
                <input 
                  type="password"
                  autoFocus
                  value={verifyPassword}
                  onChange={(e) => setVerifyPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmSave()}
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-4 text-sm text-white focus:border-rose-500/50 outline-none"
                  placeholder="Enter your account password"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button 
                onClick={() => { setShowVerifyModal(false); setVerifyPassword(''); }}
                className="flex-1 py-4 text-xs font-bold text-slate-500 hover:text-white transition-all uppercase tracking-widest"
              >
                Go Back
              </button>
              <button 
                onClick={confirmSave}
                disabled={isSaving || !verifyPassword}
                className="flex-[2] bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold py-4 rounded-xl transition-all shadow-lg shadow-rose-500/20 uppercase tracking-widest disabled:opacity-50"
              >
                {isSaving ? 'Authorizing...' : 'Authorize Change'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
