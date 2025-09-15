# Copilot Instructions for this repo

Purpose: give AI agents the shortest path to be productive in this monorepo. Prefer concrete patterns and files over generic advice.

## Big picture
- Monorepo managed by pnpm. Workspaces are defined in `pnpm-workspace.yaml`.
- Two primary apps:
  - `apps/congrong-private-api` — Backend API built with Nitro, deployed to Cloudflare Workers (KV, R2, D1, AI). Source under `server/` per Nitro.
  - `apps/congrong-private-wx` — uni-app WeChat Mini Program client calling the API; uses Pinia and WeChat dev tooling.
- Shared libs live in `packages/*` (UI, preset, utils, etc.).

## API app architecture (Nitro on Cloudflare)
- Config: `apps/congrong-private-api/nitro.config.ts`.
  - `srcDir: 'server'`, `preset: 'cloudflare_module'`, `modules: [nitro-cloudflare-dev]`.
  - `scheduledTasks` define cron tasks mapping to `server/tasks/**` (e.g., `market:fluctuation`). Add new tasks and register them here.
  - `routeRules` set CORS headers for key prefixes. If your new endpoint needs CORS, add it here.
  - Storage bindings: `storage.db` uses Cloudflare KV in prod (`binding: 'congrong-private-api'`), and filesystem under `.data` in dev.
- Cloudflare bindings and middleware establish per-request context:
  - `server/middleware/d1.ts` sets `event.context.db` (Drizzle D1). Schema in `apps/congrong-private-api/db/schema/**` and re-exported in `server/utils/db.ts`.
  - `server/middleware/ai.ts` sets `event.context.ai` (Cloudflare AI binding).
  - `server/middleware/bucket.ts` sets `event.context.bucket` (R2 bucket).
  - `server/middleware/jwt.ts` authenticates requests, populates `event.context.userId` and `event.context.user`. Public paths are listed in this file; anything else requires `Authorization: Bearer <token>`.
  - `server/middleware/token.ts` demonstrates KV-backed caching with `useStorage('db')` (e.g., WeChat access_token).
- Standard API response helpers in `server/utils/response.ts`:
  - Success: `createSuccessResponse(data, message)`
  - Error: `createErrorResponse(message, code, data)`
  - Response shape: `{ code, message, data, timestamp }` with `code === 0` for success.

## Patterns to copy when adding endpoints
- File naming: `server/api/<path>/<name>.<method>.ts` (e.g., `server/api/user/create.post.ts`). `server/api/[...].ts` answers preflight `OPTIONS`.
- Validate inputs with Zod, then return standardized responses:
  - Import validation: `const schema = z.object({ ... })`.
  - On failure: combine `validationResult.error.errors.map(e => e.message)` and `createErrorResponse(msg, 400)`.
  - DB access: `event.context.db` + tables from `server/utils/db.ts` (e.g., `usersTable`, `eq`, `sql`).
  - Auth: if protected, ensure the path is not in `jwt.ts` public list; consume `event.context.user`.
  - External calls: throttle with `RequestQueue` from `server/utils/queue.ts` (see `server/routes/exchanges/**`).
  - AI calls: get base URL via `event.context.ai.gateway('congrong-private-ai').getUrl('deepseek')`; models from `@ai-sdk/deepseek` and helpers in `server/utils/ai-sdk.ts`. System prompt in `server/api/ai/prompt.ts`.
  - R2 uploads: use `event.context.bucket.put(key, data, { httpMetadata })`; public URL base currently `https://bucket.congrongtech.cn/`.

## Data & schema
- Drizzle config: `apps/congrong-private-api/drizzle.config.ts` outputs to `apps/congrong-private-api/drizzle/` and reads schema from `apps/congrong-private-api/db/schema`.
- Add or change tables under `db/schema/**`. Re-export commonly used tables in `server/utils/db.ts` for easy imports.

## Local dev, build, deploy (API)
- Scripts (in `apps/congrong-private-api/package.json`):
  - `pnpm dev` → Nitro dev server with local FS storage. Ensure required envs exist (see runtime config below).
  - `pnpm build` → outputs worker to `.output/`. `pnpm preview` runs `node .output/server/index.mjs`.
  - `pnpm migrate:db` → `drizzle-kit generate` then `wrangler d1 migrations apply congrong-private-api --remote`.
- Runtime config (`useRuntimeConfig()`): values come from env at build/deploy time. Keys used: `appId`, `appSecret`, `jwtSecret`, `telegram.*`, `bybit.*`, `binance.*`, `deepseek.apiKey`, `coingecko.*`.
- Cloudflare/Wrangler: `apps/congrong-private-api/wrangler.toml` defines KV/D1/R2 and the worker entry. `worker-configuration.d.ts` lists binding types.
- CI/CD: `.github/workflows/deploy-cloudflare.yml` builds with Node 22 + pnpm and deploys `.output` via `cloudflare/wrangler-action@v3`. Secrets required: `CLOUDFLARE_*`, `APP_ID`, `APP_SECRET`, `JWT_SECRET`, `BOT_TOKEN`, `AUTH_TOKEN`, `BINANCE_API_URL`, `BYBIT_API_URL`, `DEEPSEEK_API_KEY`.

## WX app quick notes
- `apps/congrong-private-wx` uses uni-app. Common scripts: `dev`, `build:*`, and upload via `weapp-ide-cli` (`upload:build`). Its README documents auth/permission patterns; it consumes the API above.

## When in doubt, look here first
- Config: `apps/congrong-private-api/nitro.config.ts`
- Middleware/context: `server/middleware/*.ts`
- Responses: `server/utils/response.ts`
- DB utils/tables: `server/utils/db.ts` and `db/schema/**`
- AI: `server/api/ai/*.ts` and `server/utils/ai-sdk.ts`
- Example routes: `server/api/user/*.ts`, `server/api/upload/image.post.ts`, `server/routes/exchanges/**`

Questions to confirm or extend:
- Local env workflow: do we prefer `.env` files or shell-exported variables for `runtimeConfig` during `pnpm dev`?
- Any additional CORS prefixes that should be pre-wired in `routeRules` for upcoming endpoints?