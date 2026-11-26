# Bots

A full stack web app for creating AI companions. Every bot has its own look, its own
conversation and — with an E2B key — its own cloud computer. Use your own AI
provider key or an optional deployment-provided inference service.

Built with Next.js (App Router), Postgres and Drizzle ORM.

## What's inside

- **Bots with a face.** Pick a shape and a colour; the avatar looks at your cursor,
  blinks, and animates while it works.
- **A chat that feels like a chat.** Markdown, inline tool steps, quick-reply
  choices, voice replies and dictation.
- **A computer your bot can drive.** Screen, files and a live preview of anything
  it builds, side by side with the conversation.
- **Email drafts in the conversation.** Ask a bot to write an email and it appears
  as an editable card — review, change a line, then press Send. Nothing is sent
  until you do.
- **Artifacts, skills and privacy mode.** Everything a bot saves is kept for you,
  tools can be scoped per bot, and Privacy Mode pauses the bot while you take over
  its computer.

## Requirements

- Node.js 20+
- A Postgres database

## Setup

```bash
npm install
cp .env.example .env          # then point DATABASE_URL at your database
npm run db:migrate            # creates the tables (users, sessions, bots, messages…)
npm run dev                   # http://localhost:3000
```

Open the app, create an account on the sign-in page and you're in. Add your AI provider
key (and optionally an E2B key) under Settings, unless the operator has configured included AI. See [Gemma and included AI](docs/gemma.md) for hosting requirements and limitations.

## Scripts

| Script              | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Start the dev server                              |
| `npm run build`     | Production build                                  |
| `npm start`         | Run the production build                          |
| `npm run typecheck` | Type check                                        |
| `npm run lint`      | Lint                                              |
| `npm run db:migrate`| Apply the migrations in `drizzle/`                |
| `npm run db:push`   | Push the schema straight to the database          |
| `npm run db:studio` | Browse the database                               |

## Environment

| Variable               | Required | Description                                                        |
| ---------------------- | -------- | ------------------------------------------------------------------ |
| `DATABASE_URL`         | yes      | Postgres connection string                                          |
| `APP_SECRET`           | no       | Secret used to encrypt stored API keys (falls back to the DB URL)   |
| `APP_ORIGIN`           | no       | Public URL, used as the OAuth callback origin for connections       |
| `BLOB_READ_WRITE_TOKEN`| no       | Vercel Blob token, used for avatar uploads                          |
| `RESEND_API_KEY`       | no       | Deployment-wide sender via Resend's HTTP API                        |
| `RESEND_FROM`          | no       | From header for Resend sends                                        |
| `SMTP_HOST`            | no       | Deployment-wide SMTP relay used to send mail                        |
| `SMTP_PORT`            | no       | `587` (STARTTLS) by default, `465` for TLS                          |
| `SMTP_USER`            | no       | SMTP username                                                       |
| `SMTP_PASS`            | no       | SMTP password                                                       |
| `SMTP_FROM`            | no       | From header for SMTP sends (defaults to `SMTP_USER`)                |
| `GOOGLE_CLIENT_ID`     | no       | Alternative sender: OAuth client ID (`gmail.send`)                  |
| `GOOGLE_CLIENT_SECRET` | no       | Alternative sender: OAuth client secret                             |
| `GOOGLE_REFRESH_TOKEN` | no       | Alternative sender: refresh token with `gmail.send`                 |

## Sending email

The simplest setup needs **no environment variables at all**: open Settings →
Connections → Email and save a Gmail address with a 16-character
[app password](https://myaccount.google.com/apppasswords). Mail is sent from that
mailbox through SMTP, encrypted at rest and used only for sending.

If you would rather not use per-account credentials, the deployment can carry its
own sender. On Vercel, prefer an HTTP mail API (`RESEND_API_KEY`, `RESEND_FROM`) —
Vercel pauses work as soon as a function responds, which makes a held-open SMTP
connection the less reliable choice. SMTP is there too (`SMTP_HOST`, `SMTP_USER`,
…, works with Postmark, Fastmail or any relay; Vercel allows 465 and 587 but
blocks 25). Or install the Google connector and let people press **Connect Google**
(per-user tokens via Vercel Connect), or set the three `GOOGLE_*` variables to use
an OAuth client of your own.

Order of preference when a send starts:

1. the person's saved mailbox (their own address, app password)
2. their Google connection from Vercel Connect
3. the deployment's Google OAuth client (`GOOGLE_*`)
4. the deployment's Resend account (`RESEND_*`)
5. the deployment's SMTP relay (`SMTP_*`)

Whichever one is used, the flow is the same: a bot drafts an email, it lands in the
chat as an editable card, and nothing leaves until you press **Send**. A draft is
claimed while it is in flight so two tabs can't send it twice, and it is released
again if the send fails, so pressing Send once more is always safe. Settings →
Connections shows which sender is active, and a failed send explains what is
missing instead of just saying "couldn't send".

## Deploying

The app is a normal Next.js project. Point `DATABASE_URL` at Postgres, run
`npm run db:migrate` against it, and deploy. Migrations are idempotent where they can
be, so they are safe to run on an existing database.

## Free cloud AI (optional)

Settings → AI Provider offers three explicitly opted-in anonymous routes: **Try Kilo Free** (`kilo-auto/free`), **Try Gemma via Kilo** (`google/gemma-4-26b-a4b-it:free`), and **Try OVHcloud** (`gpt-oss-20b`). No personal API key is required. Each sends the conversation, tool definitions and tool results to the selected provider and its model providers. Some free models may collect data; consult each provider's policy before opting in. Selecting a route replaces any saved personal AI provider and key after confirmation. The routes use fixed hosts and models and do not automatically fall back to a paid model or another provider.

Both are rate-limited and availability or terms can change. Kilo documents a free-model limit per IP, while OVHcloud documents an anonymous limit per IP and model. These are not unlimited or guaranteed services. An agent turn can involve several model requests, so it may use multiple requests of a provider's quota. See [Kilo authentication](https://kilo.ai/docs/gateway/authentication), [Kilo usage and billing](https://kilo.ai/docs/gateway/usage-and-billing), and [OVHcloud getting started](https://help.ovhcloud.com/csm/en-public-cloud-ai-endpoints-getting-started?id=kb_article_view&sysparm_article=KB0065403).

### Helper Bots

Ask explicitly to use Helper Bots or delegate if you want the main Bot to split a hosted-model task. Up to four helpers work concurrently, using the same selected provider and model; each can make additional model requests, which may be billed or rate-limited. They are not used for ordinary requests or by Orbit Local. Helpers can use permitted research and deterministic analysis tools and create artifacts or agent-operated audio/video projects; their tools are limited to the parent Bot's enabled permissions. They cannot access connected accounts, send email, run shell commands, or operate the screen. File and project workspaces are shared, so parallel edits to the same item can conflict. Reports are available to the parent only during the current turn; unfinished helpers are stopped when it ends.
