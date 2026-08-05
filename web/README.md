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

You need two things: somewhere to run it (Vercel) and a Postgres database
(Neon has a free tier and is the least setup).

### 1. Create the database

1. Sign up at **neon.tech** and create a project
2. Copy the connection string it shows — it looks like
   `postgres://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`

### 2. Deploy to Vercel

1. At **vercel.com**, choose **Add New → Project** and import
   `amandeepsharma07/amazon-ppc-optimizer`
2. Set **Root Directory** to `web` — this matters, the repo also holds the CLI
   and the standalone dashboard
3. Add these environment variables:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `SESSION_SECRET` | any long random string |
   | `ADMIN_EMAIL` | the email you want to sign in with |
   | `ADMIN_PASSWORD` | your first password — at least 10 characters with a letter and a number |

4. Deploy

### 3. Create the tables and your admin account

Run once, from a terminal on your own machine, with the same `DATABASE_URL`:

```bash
cd web
npm install
DATABASE_URL="postgres://…" ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="…" npm run db:init
```

It prints `Tables ready.` and `Created admin …`. It's safe to run again later —
existing accounts keep their passwords.

Then open your Vercel URL and sign in.

## Running it locally

```bash
cd web
npm install
cp .env.example .env.local     # fill in DATABASE_URL and the admin details
npm run db:init
npm run dev                    # http://localhost:3000
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
