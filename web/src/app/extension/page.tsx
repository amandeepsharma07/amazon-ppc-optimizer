import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import build from "../../../public/extension-build.json";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "What's wrong",
    body: "Scores the listing out of 100 against Amazon's rules and lists the fixes in order, "
      + "policy failures first — those risk the listing coming down, not just ranking worse.",
  },
  {
    title: "What to write",
    body: "Where the unused room is, three rebuilt titles, and a five-slot bullet plan. "
      + "Everything is assembled from the page's own attributes; nothing is invented.",
  },
  {
    title: "Tracking",
    body: "Records the Buy Box holder and price each time you open a listing, and shows 90 days "
      + "of it — who holds the Buy Box and how often, the price low and high with their dates.",
  },
  {
    title: "Products",
    body: "Exports every ASIN on a search or category page with title, price, rating, reviews "
      + "and browse node — tab-separated, so it pastes straight into a sheet.",
  },
];

export default async function ExtensionPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const size = `${Math.round(build.bytes / 1024)} kB`;

  return (
    <AppShell
      user={user}
      title="Chrome extension"
      subtitle="Audits the Amazon product page you are looking at, and shows the fixes on the page itself."
    >
      <div className="stack">
      <div className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div className="row-full" style={{ flex: "1 1 320px", maxWidth: "none" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 17 }}>{build.name}</h2>
            <p className="hint" style={{ margin: 0 }}>
              Version {build.version} · {build.files} files · {size} · build {build.sourceHash}
            </p>
          </div>
          <a
            className="btn narrow"
            href="/listing-audit-extension.zip"
            download
            style={{ flex: "0 0 auto" }}
          >
            Download
          </a>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Always the version currently deployed here, so downloading again after an update
          gets you the latest. SHA-256 <code>{build.sha256.slice(0, 16)}…</code>
        </p>
      </div>

      <div className="card">
        <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Installing it, first time</h2>
        <p className="hint">
          Chrome cannot load a .zip directly — the folder inside it is what gets loaded.
        </p>
        <ol className="steps">
          <li><b>Unzip it.</b> Right-click the downloaded file → <b>Extract All</b>.
            You get a folder called <code>{build.folder}</code>. Keep it somewhere permanent —
            Chrome loads it from wherever it sits, so deleting it later removes the extension.</li>
          <li>Open <code>chrome://extensions</code> in a new tab.</li>
          <li>Turn on <b>Developer mode</b>, top right.</li>
          <li>Click <b>Load unpacked</b> and select the <code>{build.folder}</code> folder.</li>
          <li>Open any Amazon product page. The panel appears on the right.</li>
        </ol>
      </div>

      <div className="card">
        <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Updating it later</h2>
        <ol className="steps">
          <li>Download again from this page and extract it over the same folder,
            replacing the files when asked.</li>
          <li>On <code>chrome://extensions</code>, press the <b>reload arrow</b> on the
            extension&apos;s card.</li>
          <li>Refresh the Amazon tab.</li>
        </ol>
        <p className="hint" style={{ marginBottom: 0 }}>
          The reload step is the one people miss. Skipping it looks exactly like the
          extension being broken — Chrome keeps running the old copy until told otherwise.
        </p>
      </div>

      <div className="card">
        <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>What it does</h2>
        <div className="feature-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="feature">
              <b>{f.title}</b>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>It cannot get you rate-limited</h2>
        <p className="hint" style={{ marginBottom: 8 }}>
          The extension makes <b>no network requests at all</b> — no fetching, no background
          polling, no remote assets. It reads the page your browser has already downloaded and
          rendered, and that is the whole of its contact with the outside world. What triggers
          Amazon&apos;s throttling is request volume; zero requests cannot be throttled.
        </p>
        <p className="hint" style={{ margin: 0 }}>
          It holds one permission, <code>storage</code>, used for your settings and the Buy Box
          history. The history stays in that browser and is never uploaded. The full breakdown is
          in the extension&apos;s own README, inside the download.
        </p>
      </div>
      </div>
    </AppShell>
  );
}
