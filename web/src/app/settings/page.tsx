import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import AmazonConnection from "@/components/AmazonConnection";
import { coverage, hasEncryptionKey, listAccounts, recentJobs } from "@/lib/research";
import { suggestKey } from "@/lib/secrets";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  const [accounts, jobs, held] = await Promise.all([listAccounts(), recentJobs(), coverage()]);

  return (
    <AppShell
      user={user}
      title="Amazon connection"
      subtitle={"Connect Selling Partner API once and the search term data pulls itself every day. "
        + "This is Amazon's own interface, called with your credentials against published rate "
        + "limits — not scraping, and not something that puts your account or address at risk."}
    >
      <AmazonConnection
        accounts={accounts}
        jobs={jobs}
        coverage={held}
        hasKey={hasEncryptionKey()}
        suggestedKey={suggestKey()}
      />
    </AppShell>
  );
}
