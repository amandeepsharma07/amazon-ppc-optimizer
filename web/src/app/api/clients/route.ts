import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { addAsins, createClient, deleteClient, removeAsin } from "@/lib/research";
import { MARKETPLACE_IDS } from "@/lib/spapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "create") {
      const name = String(body.name ?? "").trim();
      const marketplace = String(body.marketplace ?? "IN");
      if (!name) return NextResponse.json({ error: "Give the client a name." }, { status: 400 });
      if (!MARKETPLACE_IDS[marketplace]) {
        return NextResponse.json({ error: "Pick a marketplace Amazon serves." }, { status: 400 });
      }
      const id = await createClient(name, marketplace, user.email);
      return NextResponse.json({ ok: true, id, message: `${name} added.` });
    }

    if (action === "delete") {
      await deleteClient(String(body.id));
      return NextResponse.json({ ok: true, message: "Client removed." });
    }

    if (action === "add-asins") {
      const { added, rejected } = await addAsins(String(body.id), String(body.asins ?? ""));
      if (!added && rejected.length) {
        return NextResponse.json(
          { error: `None of those look like ASINs: ${rejected.slice(0, 5).join(", ")}` },
          { status: 400 }
        );
      }
      return NextResponse.json({
        ok: true,
        message: `${added} ASIN${added === 1 ? "" : "s"} added`
          + (rejected.length ? `, ${rejected.length} ignored (${rejected.slice(0, 3).join(", ")})` : "."),
      });
    }

    if (action === "remove-asin") {
      await removeAsin(String(body.id), String(body.asin ?? ""));
      return NextResponse.json({ ok: true, message: "Removed." });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 }
    );
  }
}
