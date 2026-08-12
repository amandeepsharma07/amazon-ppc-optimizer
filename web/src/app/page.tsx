import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { setupState } from "@/lib/setup";
import AppShell from "@/components/AppShell";
import Analyzer from "@/components/Analyzer";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const state = await setupState();
  if (state.state !== "ready") redirect("/setup");
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <AppShell
      user={user}
      title="Analyze reports"
      subtitle="Files are read in this browser and never uploaded. Only a summary of each run is saved to your history."
    >
      <Analyzer />
    </AppShell>
  );
}
