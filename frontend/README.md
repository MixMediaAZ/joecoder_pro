# JoeCoder Pro 20.1 Frontend

Guided Job Rail UI built with Next.js 16, React 19, and TypeScript.

## Local Development

1. Copy `.env.example` to `.env.local`.
2. Set `JC_BACKEND_ORIGIN` to your running JoeCoder backend.
3. Install deps and run dev server:

```bash
npm install
npm run dev
```

Default URL: `http://localhost:3000`

## Required Environment

Use these values in local/dev/prod:

- `JC_BACKEND_ORIGIN` (required): backend base URL used by Next rewrites
- `NEXT_PUBLIC_APP_URL` (recommended): public frontend URL
- `NEXT_PUBLIC_API_URL` (optional fallback)
- `NEXT_PUBLIC_STAGING_BACKEND_ORIGIN` (optional): staging health check target in UI
- `NEXT_PUBLIC_PRODUCTION_BACKEND_ORIGIN` (optional): production health check target in UI

## Build and Quality Checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Deployment

### Vercel

Set these project environment variables:

- `JC_BACKEND_ORIGIN=https://your-joecoder-backend.example`
- `NEXT_PUBLIC_APP_URL=https://your-frontend-domain.example`

Deploy command:

```bash
npm run build
```

### Self-hosted Node

```bash
npm run build
npm run start
```

Run behind a reverse proxy (Nginx/Caddy/IIS) and ensure `/api/v1/*` reaches the backend origin configured by `JC_BACKEND_ORIGIN`.

## GitHub Readiness

This repo includes a frontend CI workflow at `.github/workflows/frontend-ci.yml` that runs:

- install (`npm ci`)
- typecheck (`npx tsc --noEmit`)
- lint (`npm run lint`)
- build (`npm run build`)

## Notes

- The Guided Job Rail is intentionally simple and keeps technical controls behind a menu for non-technical operators.
- Build mode is stage-gated by inspection + plan quality + peer-review confirmation.
- More options now includes deployment profile health checks for local/staging/production/custom backends.
- The frontend does not call internal lifecycle endpoints directly; server runtime remains the authority.