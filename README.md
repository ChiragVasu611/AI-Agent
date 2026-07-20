# AI-Agent — Enterprise AI Framework

A Next.js 13 (App Router) workspace that orchestrates multiple AI agent modules —
starting with an 8-agent "App Factory" pipeline that turns a reference app URL
into a built, tested mobile app — from a single dashboard.

## Stack

- **Framework:** Next.js 13 (App Router), TypeScript, Tailwind CSS + shadcn/ui
- **Database:** MongoDB via Mongoose
- **Auth:** Custom email/password auth — bcrypt password hashing, JWT session
  stored in an httpOnly cookie, verified in `middleware.ts`
- **AI provider:** NVIDIA Nemotron models via OpenRouter (an OpenRouter API key
  is required)

## Getting started

### 1. Start MongoDB

Use a local MongoDB instance (MongoDB Compass can connect to and inspect it):

```bash
mongod --dbpath /path/to/data
```

### 2. Configure environment variables

Create a `.env.local` file in the project root:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/ai-agent
AUTH_SECRET=replace-with-a-long-random-string

# OpenRouter (NVIDIA Nemotron free models). Required — the AI pipeline throws
# without a key. Use one key per model, or set OPENROUTER_API_KEY as a shared
# fallback for both.
OPENROUTER_API_KEY_ULTRA=   # nvidia/nemotron-3-ultra-550b-a55b:free
OPENROUTER_API_KEY_SUPER=   # nvidia/nemotron-3-super-120b-a12b:free
```

### 3. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up for an account,
and you'll land on the dashboard.

## Auth notes

- Sign-up creates the account and signs you in immediately — there is no email
  verification step, since no email provider is configured.
- "Forgot password" generates a reset link and displays it directly in the UI
  (no SMTP integration yet); wire up a real email provider before shipping to
  production.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — lint the codebase
- `npm run typecheck` — run the TypeScript compiler with no emit
