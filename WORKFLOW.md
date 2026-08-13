# How to work on this project

Keep this file. It covers the one-time setup, what you do day to day, and the
handful of errors worth recognising.

The short version: **GitHub is the single source of truth.** Once the code
lives there, Vercel rebuilds itself on every push and your PC stays in step
with one command. Everything that went wrong early on came from moving code
around as downloaded archives instead.

---

## Part 1 — One-time setup

Do this once. After it, you never repeat it.

### 1. Push the code to GitHub

In VS Code's terminal, one line at a time:

```powershell
cd C:\Users\hp\Documents\GitHub\amazon-ppc-optimizer
```
```powershell
git add -A
```
```powershell
git commit -m "Add web app"
```
```powershell
git push origin main
```

A browser window may open to confirm your GitHub login — approve it. Look for
a line ending in `main -> main`.

Then open the repository on github.com and confirm you can see a **`web`**
folder. If it isn't there, nothing else will work.

### 2. Connect Vercel

1. **vercel.com** → **Add New** → **Project**
2. Import `amandeepsharma07/amazon-ppc-optimizer`
3. Next to **Root Directory**, click **Edit** and choose **`web`**
   — the repository root holds the CLI and the standalone dashboard, not the app
4. Add one environment variable:
   `DATABASE_URL` = your Neon connection string
5. **Deploy**

Two more are optional, needed only for the automatic Amazon data:

| Variable | When you need it |
|---|---|
| `SPAPI_ENCRYPTION_KEY` | Before saving Amazon credentials. The Amazon connection page generates one for you to paste — keep a copy, because changing it makes the stored credentials unreadable |
| `CRON_SECRET` | Optional. Set it and the daily job refuses callers without it |

Vercel now watches the repository. **Every push deploys automatically** — you
never touch the Vercel dashboard again unless you want to change a setting.

---

## Part 2 — Day to day

### When you change something yourself

```powershell
cd C:\Users\hp\Documents\GitHub\amazon-ppc-optimizer
git add -A
git commit -m "what you changed"
git push origin main
```

Vercel picks it up within a minute or two. Watch progress on the Vercel
dashboard; it emails you if a build fails.

### When Claude changes something

This is the part that removes all the friction from before. Start the session
**on this repository**, not on Scalo:

1. Go to **claude.ai/code**
2. Start a new session and pick **amazon-ppc-optimizer** as the repository
3. Describe what you want

Claude then commits and pushes directly. Vercel deploys it. You refresh the
page. **No downloads, no extracting, no wondering whether the files arrived.**

To get those changes onto your PC afterwards:

```powershell
cd C:\Users\hp\Documents\GitHub\amazon-ppc-optimizer
git pull origin main
```

### Running it locally

Only needed when you want to try something before it goes live:

```powershell
cd C:\Users\hp\Documents\GitHub\amazon-ppc-optimizer\web
npm run dev
```

Then open the address it prints — usually `http://localhost:3000`. Stop it
with `Ctrl` + `C`. After a `git pull` that changed dependencies, run
`npm install` once more.

---

## Part 3 — Errors worth recognising

| What you see | What it means | What to do |
|---|---|---|
| `ENOENT ... .next\server\app\page.js` | The build cache is stale after files changed | Stop the server, `Remove-Item -Recurse -Force .next`, start again |
| `Port 3000 is in use ... using 3001` | An older copy is still running | Use the port it names, or `Stop-Process -Id <number> -Force` |
| `cd : Cannot find path ...\web` | The code isn't on your PC yet | `git pull origin main` |
| `is not recognized as the name of a cmdlet` | A line meant for a file was typed at the prompt | Only run lines shown as PowerShell commands |
| `npm error ... package.json` not found | You're in the wrong folder | `cd` into `web` first |
| Red **1 Issue** badge about hydration | A browser extension (Grammarly) edited the page | Ignore it — already suppressed in current code |
| Vercel build fails immediately | Root Directory isn't set to `web` | Vercel → Settings → General → Root Directory → `web` |
| Vercel deploys but the site still looks old | The build failed — the previous deploy is still being served | Vercel → Deployments → open the newest → read the log |
| "Database not connected" | `DATABASE_URL` missing or wrong | The page names the exact error; fix it in Vercel → Settings → Environment Variables |
| "SPAPI_ENCRYPTION_KEY is not set" | Amazon credentials can't be stored safely yet | The Amazon connection page shows a key to paste into Vercel, then redeploy |
| Amazon connection says "needs attention" | Amazon rejected something | The exact reason is on that page — usually a re-authorisation is needed after changing the app's roles |

### Two habits that avoid most of it

**Paste one line at a time.** Multi-line blocks sometimes arrive joined
together — `web` + `node` becomes `webnode` — and PowerShell reports a
confusing error about a command that doesn't exist.

**Check before continuing.** After a step that should produce something, look
for it: `dir web\src\components` after pulling, the `web` folder on GitHub
after pushing. Catching a missing step immediately is far cheaper than
debugging three steps later.

---

## What lives where

| Path | What it is |
|---|---|
| `web/` | The multi-user web app — the thing Vercel deploys |
| `web/src/lib/listing-engine.js` | The extension's listing rules, copied in on every build. Generated — edit `extension/src/audit.js` instead |
| `dashboard/index.html` | The standalone single file. No server, no database; double-click to open |
| `ppcopt/` | The Python command-line version |
| `extension/` | The Chrome extension that audits listings on the Amazon page itself |
| `examples/` | Sample bulk and search term files for testing |
| `web/assets/listing-audit-extension.zip` | The extension, packed for the download page. Generated — never edit by hand. Not in `public/`, so it is only reachable through the signed-in route |
| `web/.env.local` | Your database connection. **Never committed** — deliberately in `.gitignore` |

The first three share the same optimisation rules, so a change to how bids or
keywords are calculated benefits every version.

---

## Part 4 — The Amazon connection

Set up once, then the search term data arrives on its own.

1. **Seller Central** → **Apps & Services** → **Develop Apps**
2. Create an app, tick the **Brand Analytics** role
3. Use **Authorise** on your own account to get a **refresh token**
4. In the web app: **Amazon connection** → paste the client ID, secret and token → **Save**
5. **Test connection**, then **Pull search terms now**

A report takes Amazon a few minutes to build, which is longer than a web
request may last, so a pull happens in two steps: one asks, a later run
collects. The scheduled job at 06:00 UTC does both — collects whatever
finished, then asks for the next. After the first setup this needs no
attention.

Brand Analytics data appears a few days after each week closes, so the most
recent week will not exist yet. That is Amazon's schedule, not a fault.

---

## Part 5 — The Chrome extension

There are two ways in. **For anyone else on the team**, the web app has a
**Chrome extension** page in the menu with a download and the steps — no git,
no repository, nothing to set up. Send them the link. The download needs an
account, so disabling someone on the Team page takes it away with everything
else.

**For you**, it is simpler to load the folder you already have. Once, after
your first `git pull`:

1. Open **`chrome://extensions`**
2. Turn on **Developer mode**, top right
3. **Load unpacked** → choose
   `C:\Users\hp\Documents\GitHub\amazon-ppc-optimizer\extension`

Then open any Amazon product page and the panel appears on the right.

After a `git pull` that changed it, press the **reload arrow** on its card in
`chrome://extensions` and refresh the Amazon tab. That step is easy to forget
and looks exactly like the extension being broken.

The download on the web app is repacked from the extension folder on every
build, so what the team downloads is always what is in the repository. You
never have to remember to rebuild it. If you want to check before committing,
`npm run check:extension` in `web` says whether the committed copy is current.

| What you see | What to do |
|---|---|
| No panel on a product page | Reload the extension's card, then refresh the tab |
| "6 checks could not be read" | Scroll the whole page so everything loads, press **Re-run** |
| Panel on a search or category page | It only runs on product pages — the ones with `/dp/` in the address |
