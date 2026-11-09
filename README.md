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
