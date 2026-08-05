"use client";

import { useCallback, useEffect, useState } from "react";

interface TeamUser {
  id: string; email: string; name: string; role: "admin" | "member";
  is_active: boolean; created_at: string; last_login_at: string | null;
  active_sessions: number; run_count: number;
}

function when(value: string | null) {
  if (!value) return "never";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function TeamManager({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the team.");
      setUsers(data.users);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name, password, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add that person.");
      setNotice(`Added ${email}. Send them the password you just set — they can sign in straight away.`);
      setEmail(""); setName(""); setPassword(""); setRole("member");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  async function act(id: string, action: string, extra: Record<string, unknown> = {}) {
    setError(""); setNotice("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function resetPassword(user: TeamUser) {
    const next = window.prompt(
      `New password for ${user.email}.\nAt least 10 characters, with a letter and a number.\nThey will be signed out everywhere.`
    );
    if (!next) return;
    await act(user.id, "password", { password: next });
    setNotice(`Password changed for ${user.email}. Send it to them — they're signed out until they use it.`);
  }

  return (
    <>
      <section className="card">
        <h2 className="section">Add someone</h2>
        <p className="hint">
          You set their first password and pass it on. There's no signup page, so nobody
          can create their own account.
        </p>
        <form onSubmit={addUser}>
          <div className="row">
            <div>
              <label className="field-label" htmlFor="new-email">Email</label>
              <input id="new-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="new-name">Name</label>
              <input id="new-name" type="text" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="new-password">First password</label>
              <input id="new-password" type="text" required value={password}
                onChange={e => setPassword(e.target.value)} placeholder="at least 10 characters" />
            </div>
            <div>
              <label className="field-label" htmlFor="new-role">Can they manage the team?</label>
              <select id="new-role" value={role} onChange={e => setRole(e.target.value as "admin" | "member")}>
                <option value="member">No — analyze only</option>
                <option value="admin">Yes — admin</option>
              </select>
            </div>
            <div className="narrow">
              <button className="btn" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
            </div>
          </div>
        </form>
        {error && <p className="error-msg" role="alert">{error}</p>}
        {notice && <p className="ok-msg">{notice}</p>}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 className="section">People with access</h2>
        <p className="hint">
          “Signed in” counts devices currently holding a session. Sign out everywhere ends
          them without disabling the account.
        </p>
        {loading ? <p className="hint">Loading…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Person</th><th>Role</th><th>Status</th><th className="num">Runs</th>
                <th className="num">Signed in</th><th>Last sign-in</th><th>Added</th><th></th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name || u.email.split("@")[0]}</strong>
                      <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{u.email}</div>
                    </td>
                    <td>{u.role === "admin" ? <span className="chip warn">admin</span> : "member"}</td>
                    <td>{u.is_active ? <span className="chip good">active</span> : <span className="chip crit">disabled</span>}</td>
                    <td className="num">{u.run_count}</td>
                    <td className="num">{u.active_sessions}</td>
                    <td>{when(u.last_login_at)}</td>
                    <td>{when(u.created_at)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <button className="btn-link" onClick={() => resetPassword(u)}>Reset password</button>
                        {u.active_sessions > 0 && (
                          <button className="btn-link" onClick={() => act(u.id, "signout")}>Sign out everywhere</button>
                        )}
                        {u.id !== currentUserId && (
                          <button className="btn-link"
                            onClick={() => act(u.id, "role", { role: u.role === "admin" ? "member" : "admin" })}>
                            Make {u.role === "admin" ? "member" : "admin"}
                          </button>
                        )}
                        {u.id !== currentUserId && (
                          u.is_active
                            ? <button className="btn-link danger" onClick={() => act(u.id, "disable")}>Disable</button>
                            : <button className="btn-link" onClick={() => act(u.id, "enable")}>Re-enable</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
