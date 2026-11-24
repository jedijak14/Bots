# Bots

A full stack web app for creating AI companions. Every bot has its own look, its own
conversation and — with an E2B key — its own cloud computer. You bring your own AI
provider key; nothing is sent anywhere else.

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
key (and optionally an E2B key) under Settings.

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
| `GOOGLE_CLIENT_ID`     | no       | Fallback Gmail sender: OAuth client ID (`gmail.send`)                 |
| `GOOGLE_CLIENT_SECRET` | no       | Fallback Gmail sender: OAuth client secret                            |
| `GOOGLE_REFRESH_TOKEN` | no       | Fallback Gmail sender: refresh token with `gmail.send`                |

## Sending email

Email goes out through the Gmail API, with a token from one of two places:

1. **Vercel Connect** (the default on Vercel). Users press **Connect Google** under
   Settings → Connections and consent to `gmail.send` plus read-only Gmail and YouTube
   access. This needs the Google connector installed on the Vercel project and OIDC
   enabled, so it only works in a real deployment — never on `localhost`.
2. **Your own Google OAuth client**, if `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
   `GOOGLE_REFRESH_TOKEN` are set. Connect is tried first and this is the fallback, so a
   self-hosted deployment can send mail without any per-user consent screen.

Either way the flow is the same: a bot drafts an email, it lands in the chat as an
editable card, and nothing leaves until you press **Send**. A draft is claimed while it
is in flight so two tabs can't send it twice, and it is released again if Gmail or the
network fails, so pressing Send once more is always safe.

## Deploying

The app is a normal Next.js project. Point `DATABASE_URL` at Postgres, run
`npm run db:migrate` against it, and deploy. Migrations are idempotent where they can
be, so they are safe to run on an existing database.
