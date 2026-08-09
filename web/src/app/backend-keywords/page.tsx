import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import BackendKeywords from "@/components/BackendKeywords";

export const dynamic = "force-dynamic";

export default async function BackendKeywordsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <AppShell
      user={user}
      title="Backend keywords"
      subtitle="Turn your search term report into the hidden Search Terms field, built to Amazon's rules for your marketplace."
    >
      <BackendKeywords />
    </AppShell>
  );
}
