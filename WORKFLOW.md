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
| "Database not connected" | `DATABASE_URL` missing or wrong | The page names the exact error; fix it in Vercel → Settings → Environment Variables |

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
| `dashboard/index.html` | The standalone single file. No server, no database; double-click to open |
| `ppcopt/` | The Python command-line version |
| `examples/` | Sample bulk and search term files for testing |
| `web/.env.local` | Your database connection. **Never committed** — deliberately in `.gitignore` |

All three share the same optimisation rules, so a change to how bids or
keywords are calculated benefits every version.
