import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import ClientManager from "@/components/ClientManager";
import { clientAsins, coverage, listClients, termsForClient } from "@/lib/research";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { id } = await searchParams;
  const clients = await listClients();
  const selected = clients.find(c => c.id === id) ?? null;

  const [asins, terms, held] = await Promise.all([
    selected ? clientAsins(selected.id, selected.marketplace) : Promise.resolve([]),
    selected ? termsForClient(selected.id, selected.marketplace) : Promise.resolve([]),
    coverage(),
  ]);

  return (
    <AppShell
      user={user}
      title="Clients"
      subtitle={"Group each client's ASINs once, then research runs across the whole portfolio "
        + "instead of one product at a time. The search term data is the marketplace's, not an "
        + "account's — so one upload per marketplace covers every client in it."}
    >
      <ClientManager
        clients={clients}
        selected={selected}
        asins={asins}
        terms={terms}
        hasData={held.some(h => h.marketplace === (selected?.marketplace ?? ""))}
      />
    </AppShell>
  );
}
