import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { query } from "@/lib/db";

interface RunRow {
  id: string; ran_at: string; marketplace: string; currency: string;
  target_acos: number; sensitivity: string; file_names: string;
  spend: number; sales: number; clicks: string; orders: string;
  bid_changes: number; negatives: number; harvest: number; wasted_spend: number;
  email: string; user_name: string;
}

function fmtMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency, maximumFractionDigits: 0,
    }).format(value || 0);
  } catch {
    return String(Math.round(value || 0));
  }
}

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const runs = user.role === "admin"
    ? await query<RunRow>(
        `SELECT r.*, u.email, u.name AS user_name FROM runs r
           JOIN users u ON u.id = r.user_id
          ORDER BY r.ran_at DESC LIMIT 200`)
    : await query<RunRow>(
        `SELECT r.*, $2::text AS email, $3::text AS user_name FROM runs r
          WHERE r.user_id = $1 ORDER BY r.ran_at DESC LIMIT 200`,
        [user.id, user.email, user.name]);

  const subtitle = (user.role === "admin"
    ? "Every analysis run by anyone on the team, newest first."
    : "Your past analyses, newest first.")
    + " Only these headline figures are stored — never the reports themselves.";

  return (
    <AppShell user={user} title="History" subtitle={subtitle}>
      {!runs.length ? (
        <div className="card"><p className="hint" style={{ margin: 0 }}>
          No runs yet. Head to Analyze and upload a report.
        </p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>When</th>
              {user.role === "admin" && <th>Who</th>}
              <th>Market</th><th className="num">Target</th><th>Sensitivity</th>
              <th className="num">Spend</th><th className="num">Sales</th><th className="num">ACOS</th>
              <th className="num">Bids</th><th className="num">Negatives</th><th className="num">Harvest</th>
              <th className="num">Wasted</th><th>Files</th>
            </tr></thead>
            <tbody>
              {runs.map(r => {
                const acos = r.sales ? r.spend / r.sales : 0;
                return (
                  <tr key={r.id}>
                    <td>{new Date(r.ran_at).toLocaleString(undefined, {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })}</td>
                    {user.role === "admin" && (
                      <td className="ell" title={r.email}>{r.user_name || r.email}</td>
                    )}
                    <td>{r.marketplace}</td>
                    <td className="num">{(r.target_acos * 100).toFixed(0)}%</td>
                    <td>{r.sensitivity}</td>
                    <td className="num">{fmtMoney(r.spend, r.currency)}</td>
                    <td className="num">{fmtMoney(r.sales, r.currency)}</td>
                    <td className="num">
                      {acos ? (
                        <span className={acos <= r.target_acos ? "chip good" : "chip crit"}>
                          {(acos * 100).toFixed(1)}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="num">{r.bid_changes}</td>
                    <td className="num">{r.negatives}</td>
                    <td className="num">{r.harvest}</td>
                    <td className="num">{fmtMoney(r.wasted_spend, r.currency)}</td>
                    <td className="ell" title={r.file_names}>{r.file_names || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
