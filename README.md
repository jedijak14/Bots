# Grok-Bot

A full stack web app for creating AI companions. Every bot has its own look, its own
conversation and — with an E2B key — its own cloud computer. You bring your own AI
provider key; nothing is sent anywhere else.

Built with Next.js (App Router), Postgres and Drizzle ORM.

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

| Variable       | Required | Description                                                        |
| -------------- | -------- | ------------------------------------------------------------------ |
| `DATABASE_URL` | yes      | Postgres connection string                                          |
| `APP_SECRET`   | no       | Secret used to encrypt stored API keys (falls back to the DB URL)   |

## Conversations, skills, and desktop safety

Clearing an individual bot conversation archives its visible messages instead of
removing them. They remain in the account export, and up to the latest 40 messages
(including archived ones) are sent to that same bot as context. This is bounded
context, not a guarantee that the bot remembers every past conversation. The bot
can also search its own saved history for matching text. The
Data settings' **Clear all conversations** permanently deletes both active and
archived messages. Deleting a bot also deletes its history.

Skills are reusable instructions shared with all of the account's bots and sent
to the configured model provider. They are not secret storage. Stories and other
standalone writing may be returned in `artifact` fenced blocks and displayed as
viewable documents in chat.

**The desktop's Take control button is not a privacy mode.** The bot has shell,
filesystem, and browser access to the same computer after control is returned.
Do not enter passwords, tokens, or other credentials there. Browser sessions are
not securely persisted and may disappear when the E2B sandbox expires. A secure
private desktop handoff, persistent browser sessions, and a separate isolated
privacy bot are not implemented. The controls do not prevent concurrent sessions
or running agent tools from accessing the computer. A hidden bot typing a password
into this shared desktop would not keep it secret: processes or browser extensions
started earlier could capture keystrokes or browser sessions. OAuth avoids placing
the password or access token in the desktop, but it does not sign the desktop's
browser into Google.

## Google connections

Gmail and YouTube use Google's OAuth consent page in the user's own browser,
not the bot desktop. The server stores encrypted refresh tokens, and a server-only
broker performs narrowly defined operations without returning tokens to the model.
Tokens are authenticated-encrypted and bound to the user and service. Bots can
request a connection in chat; after consent, the user returns to that chat.
This is logical separation within the same application, **not** a separate
security service: deployment administrators with access to the app's encryption
key and database can decrypt tokens. Do not put credentials in chat or skills.

Configure a Google Cloud OAuth web client, enable the Gmail API and YouTube Data
API, and configure the OAuth consent screen. Add the exact authorized redirect URI
`https://YOUR-ORIGIN/api/connections/google/callback`. Set `APP_ORIGIN` to the
exact public origin with no trailing slash, plus `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and a unique, stable `APP_SECRET` of at least 32
characters. HTTPS is required outside local development. Users can then connect
from Settings > Connections. Changing `APP_SECRET` without migrating encrypted
values breaks existing API keys and connections. Google may require verification
or approved test users for Gmail's restricted scopes; simply adding client
credentials does not bypass Google's requirements.

Gmail requests read-only access and permission to send. The bot can search and
read mail at the user's request; the contents sent to the configured AI provider
are not secret from that provider. The bot can prepare a single-recipient email,
but only the signed-in user can approve and send the exact displayed draft.
Sending is not retried automatically if delivery is uncertain; check Sent before
trying again. YouTube access is read-only and currently lists playlists. Disconnect
removes the stored token locally; revoke the grant in your Google account as well.
GitHub, Notion, Spotify, and Vercel OAuth integrations are not yet implemented.

Run `npm run db:migrate` when upgrading to create the archive and skills schema.
