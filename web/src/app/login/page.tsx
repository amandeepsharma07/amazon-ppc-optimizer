"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.setup) { router.replace(data.setup); return; }
        setError(data.error ?? "Could not sign in.");
        setBusy(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card center-card" onSubmit={submit}>
        <h1>PPC Optimizer</h1>
        <p className="sub">Sign in to continue.</p>
        <div className="stack">
          <div>
            <label className="field-label" htmlFor="email">Email</label>
            <input
              id="email" type="email" autoComplete="username" autoFocus required
              value={email} onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="password">Password</label>
            <input
              id="password" type="password" autoComplete="current-password" required
              value={password} onChange={e => setPassword(e.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
        {error && <p className="error-msg" role="alert">{error}</p>}
        <p className="sub" style={{ margin: "18px 0 0", fontSize: 12 }}>
          Ad reports are read in your browser and never uploaded — only a summary of each run is saved.
        </p>
      </form>
    </div>
  );
}
