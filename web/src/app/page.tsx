import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import Analyzer from "@/components/Analyzer";

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <div className="shell">
      <TopBar email={user.email} role={user.role} />
      <h1 className="page">Analyze reports</h1>
      <p className="page-sub">
        Files are read in this browser and never uploaded. Only a summary of each run is saved to your history.
      </p>
      <Analyzer />
    </div>
  );
}
