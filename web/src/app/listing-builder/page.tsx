import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ListingBuilder from "@/components/ListingBuilder";

export const dynamic = "force-dynamic";

export default async function ListingBuilderPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <AppShell
      user={user}
      title="Listing builder"
      subtitle={"Write the title, bullets and description with your keywords ticking off as you use "
        + "them, live character counts, and the same policy checks the Chrome extension runs — so "
        + "problems are caught here rather than by Amazon after you publish."}
    >
      <ListingBuilder />
    </AppShell>
  );
}
