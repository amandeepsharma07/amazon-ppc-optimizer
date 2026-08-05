import { redirect } from "next/navigation";
import { setupState } from "@/lib/setup";
import SetupForm from "@/components/SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const state = await setupState();
  if (state.state === "ready") redirect("/login");

  if (state.state === "no-database") {
    return (
      <div className="center-page">
        <div className="card center-card" style={{ maxWidth: 520 }}>
          <h1>Database not connected</h1>
          <p className="sub">
            The app is running, but it can&apos;t reach a database — so there&apos;s nowhere to keep
            accounts yet.
          </p>
          <p style={{ fontSize: 13.5, margin: "0 0 12px" }}>
            Add a <code>DATABASE_URL</code> environment variable in your hosting dashboard,
            pointing at a Postgres database, then redeploy. It looks like:
          </p>
          <pre style={{
            background: "var(--surface-2)", padding: "10px 12px", borderRadius: 8,
            fontSize: 12, overflowX: "auto", margin: "0 0 14px",
          }}>postgres://user:password@host/dbname?sslmode=require</pre>
          <p className="sub" style={{ margin: 0 }}>
            The exact problem was: <span style={{ color: "var(--crit)" }}>{state.detail}</span>
          </p>
        </div>
      </div>
    );
  }

  return <SetupForm />;
}
