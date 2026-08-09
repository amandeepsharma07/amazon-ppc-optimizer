# Running the web app on your own PC

You don't need Vercel, Render, or any hosting to try this. It runs on your
machine and you open it at `http://localhost:3000`.

Two things have to be in place: **Node.js**, and a **Postgres database** for it
to keep accounts in. The database is the only real decision — the easy route is
a free hosted one, so there's nothing to install.

---

## Step 1 — Install Node.js (once)

Download the **LTS** installer from **nodejs.org** and run it, accepting the
defaults. To confirm it worked, open VS Code and press ``Ctrl` `` for a
terminal, then:

```powershell
node -v
```

You want `v20` or higher.

---

## Step 2 — Get a database

### Option A — free hosted, nothing to install (recommended)

1. Sign up at **neon.tech** (free, no card)
2. Create a project — call it anything
3. Copy the **connection string** it shows you. It looks like:

```
postgres://alex:AbC123@ep-cool-frost-12345.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

That's all you need. It works whether you're at home or anywhere else, as long
as you're online.

### Option B — Postgres on your PC, works offline

1. Download the Windows installer from **postgresql.org/download/windows**
2. Run it, and **write down the password** you set for the `postgres` user
3. Leave the port as `5432`
4. Your connection string is then, with your own password:

```
postgres://postgres:YOURPASSWORD@localhost:5432/postgres
```

---

## Step 3 — Open the project in VS Code

**File → Open Folder** → `C:\Users\hp\Documents\GitHub\amazon-ppc-optimizer`

---

## Step 4 — Point it at your database

In the Explorer panel, expand the **web** folder, right-click it and choose
**New File**. Name the file exactly:

```
.env.local
```

Put one line in it — your connection string from step 2:

```
DATABASE_URL=postgres://…paste yours here…
```

Save with `Ctrl` + `S`.

---

## Step 5 — Start it

Open a terminal in VS Code (``Ctrl` ``) and run these two lines. The first one
downloads what the app needs and takes a minute or two; you only ever do it
once.

```powershell
cd web
npm install
npm run dev
```

When you see **Ready**, open **http://localhost:3000** in your browser.

The first time, it asks you to create your admin account. After that it's the
normal sign-in page, and everything works exactly as it would when hosted —
Analyze, History and Team.

To stop the app, click the terminal and press `Ctrl` + `C`. To start it again
later, just `cd web` and `npm run dev` — no reinstalling.

---

## If something goes wrong

**"Database not connected"** — the page names the exact problem underneath.
Usually the connection string has a typo, or (with Option B) Postgres isn't
running: open **Services** in Windows and check `postgresql-x64-16` is started.

**`npm` is not recognised** — Node.js isn't installed, or VS Code was open
during the install. Close VS Code completely and reopen it.

**Port 3000 already in use** — something else is using it. Run
`npm run dev -- -p 3001` and use `http://localhost:3001` instead.

---

## Worth knowing

Only you can reach `localhost` — it isn't visible to anyone else, even on your
own wifi. That makes it perfect for trying the app and for your own day-to-day
use, but the moment you want a colleague or client to sign in, it has to be
hosted somewhere (see the deploy options in `README.md`).

And if you only want to *use* the optimizer rather than run the multi-user
version, `../dashboard/index.html` needs none of this — double-click it and it
opens.
