"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not finish setup.");
        setBusy(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card center-card" style={{ maxWidth: 420 }} onSubmit={submit}>
        <h1>Create your admin account</h1>
        <p className="sub">
          This is the first time anyone has opened this installation. The account you make
          here owns it and can add everyone else.
        </p>
        <div className="stack">
          <div>
            <label className="field-label" htmlFor="email">Your email</label>
            <input id="email" type="email" autoComplete="username" autoFocus required
              value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="name">Your name</label>
            <input id="name" type="text" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="new-password" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="at least 10 characters, with a number" />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account and sign in"}
          </button>
        </div>
        {error && <p className="error-msg" role="alert">{error}</p>}
        <p className="sub" style={{ margin: "18px 0 0", fontSize: 12 }}>
          This page stops working the moment an account exists, so nobody else can claim
          ownership later.
        </p>
      </form>
    </div>
  );
}
