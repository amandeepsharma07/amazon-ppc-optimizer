import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import TeamManager from "@/components/TeamManager";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  return (
    <div className="shell">
      <TopBar email={user.email} role={user.role} />
      <h1 className="page">Team</h1>
      <p className="page-sub">
        Add people, change what they can do, and cut off access. Disabling someone signs them
        out of every device immediately.
      </p>
      <TeamManager currentUserId={user.id} />
    </div>
  );
}
