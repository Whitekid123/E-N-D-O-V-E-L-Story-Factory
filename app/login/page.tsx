'use client';

import React, { useState } from 'react';

export default function LoginPage() {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign-in failed.');
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="app-bg flex items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-sm fade-up">
        <div className="text-center mb-8">
          <div className="text-[11px] font-semibold tracking-[0.35em] text-gold-400 mb-3">E N D O V E L</div>
          <h1 className="font-display text-4xl text-cream-100">Story Factory</h1>
          <p className="text-cream-500 text-sm mt-3 leading-relaxed">This studio is private. Enter your passcode to continue.</p>
        </div>
        <form onSubmit={submit} className="card p-6 md:p-8 space-y-4">
          <div>
            <label className="lbl">Passcode</label>
            <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)}
              autoFocus placeholder="Your passcode" className="field text-base" />
          </div>
          {error && (
            <p className="text-xs text-red-300 border border-red-900/60 bg-red-950/20 rounded-xl p-3 leading-relaxed">{error}</p>
          )}
          <button type="submit" disabled={busy || !passcode} className="btn btn-primary">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}