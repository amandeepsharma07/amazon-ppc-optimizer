# PPC Optimizer — web app

The server version: real accounts you create and revoke, a history of every run,
and a team page. Same analysis engine as the single-file dashboard.

**Ad reports are still parsed in the browser and never uploaded.** The server
stores who has access and a summary of each run (spend, sales, ACOS, how many
recommendations) — never your keywords, search terms, or the files themselves.

## What you get

| Page | What it does |
|---|---|
| **Analyze** | Upload bulk sheet and/or search term report, pick marketplace, target ACOS/ROAS and sensitivity, get bid changes, negatives and harvest keywords |
| **History** | Every past run. Members see their own; admins see everyone's |
| **Team** | Admins add people, reset passwords, change roles, sign someone out everywhere, or disable them |

There is no signup page — an admin creates every account, so nobody can let
themselves in.

## Deploying

The app **sets itself up**: it creates its own tables, and the first time you
open it, it asks you to create the admin account in the browser. There is no
setup command to remember and no way to end up with a live site nobody can sign
in to.

You only ever have to supply one thing: a `DATABASE_URL` pointing at a Postgres
database.

### Easiest — Render (app and database together)

Render can create both from `render.yaml` in this repository, so there is no
separate database signup and no connection string to copy.

1. At **render.com**, choose **New → Blueprint**
2. Point it at `amandeepsharma07/amazon-ppc-optimizer`
3. Click **Apply**

Open the URL it gives you and create your admin account. Note Render's free
database is time-limited; a paid instance is a few dollars a month.

### Vercel (needs a database from elsewhere)

Vercel doesn't host Postgres itself, so this is two steps rather than one.

1. Create a database at **neon.tech** and copy the connection string
   (`postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`)
2. At **vercel.com**: **Add New → Project**, import this repository, and
   **set Root Directory to `web`** — the repo also holds the CLI and the
   standalone dashboard, so this step is required
3. Add one environment variable, `DATABASE_URL`, set to the Neon connection string
4. Deploy, open the URL, create your admin account

If the site loads but you can't sign in, open `/setup` — it will say exactly
what is missing, including the database error if there is one.

### Railway

**New Project → Deploy from GitHub**, set the root directory to `web`, then
**New → Database → PostgreSQL**. Railway injects `DATABASE_URL` for you — nothing else to set.

### Optional: create the admin from the command line instead

Not required — the browser flow covers it — but useful for scripted installs:

```bash
cd web
npm install
DATABASE_URL="postgres://…" ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="…" npm run db:init
```

## Running it locally

Step-by-step for Windows and VS Code, including installing Node and getting a
database: **[RUN-ON-YOUR-PC.md](RUN-ON-YOUR-PC.md)**. The short version:

```bash
cd web
npm install
cp .env.example .env.local     # set DATABASE_URL
npm run dev                    # http://localhost:3000, then create your admin
```

Any Postgres works locally:

```bash
initdb -D ./pgdata -A trust -U postgres
pg_ctl -D ./pgdata -o "-p 5432" start
createdb -h 127.0.0.1 -U postgres ppcopt
# DATABASE_URL=postgres://postgres@127.0.0.1:5432/ppcopt
```

## Tests

```bash
npm test        # engine rules: bid maths, negative thresholds, harvesting
```

## How access actually works

Sessions are rows in the database, not self-contained tokens, and every request
re-reads the row. That's what makes **Disable** take effect on someone's next
click rather than whenever a token happens to expire — the property the
single-file version couldn't offer. Passwords are hashed with scrypt from Node's
standard library, so there's no native module to compile at deploy time.

Guards worth knowing: you can't disable your own account, and you can't remove
the last active admin. Resetting someone's password signs them out everywhere.

## Which version should you use?

The **single-file dashboard** (`../dashboard/index.html`) needs no hosting, no
database and no running costs — open it and it works. Use it if the tool is for
you or a couple of trusted people.

Use **this** when you need to grant and revoke access to people you don't fully
control, or want a record of who ran what.
