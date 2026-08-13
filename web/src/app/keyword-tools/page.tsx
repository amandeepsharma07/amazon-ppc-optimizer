import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import KeywordProcessor from "@/components/KeywordProcessor";

export const dynamic = "force-dynamic";

export default async function KeywordToolsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <AppShell
      user={user}
      title="Keyword processor"
      subtitle={"Paste keyword lists from anywhere — exports, competitor research, your own reports — "
        + "and get them deduplicated, ranked by reach, stripped of brands and claims, and packed to "
        + "the Search Terms byte limit. Everything runs in this browser; nothing is uploaded."}
    >
      <KeywordProcessor />
    </AppShell>
  );
}
