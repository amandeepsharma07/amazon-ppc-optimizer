import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import TeamManager from "@/components/TeamManager";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  return (
    <AppShell
      user={user}
      title="Team"
      subtitle="Add people, change what they can do, and cut off access. Disabling someone signs them out of every device immediately."
    >
      <TeamManager currentUserId={user.id} />
    </AppShell>
  );
}
