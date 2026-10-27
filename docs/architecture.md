# Architecture

HivePantry is a food log that AI agents write to and read from. One Cloudflare Worker serves MCP, a small REST API, and an owner console. One D1 database holds everything. It deploys from a button into the owner's own Cloudflare account, the same way HiveAttic does.

## Goals and non-goals

Goals:

- An agent can log a meal in one call and gets back the day's totals and remaining goals in the same reply.
- One click deploys a working copy on the Cloudflare free plan, with one required setting (`ADMIN_TOKEN`).
- Every number an agent reads is reproducible: past entries never change when a saved food is edited.
- Retries are safe: writes take an idempotency key.

Non-goals for this version, each a candidate for later:

- A built-in nutrition database. Agents estimate from their own knowledge or a label, then save the food. A barcode lookup against Open Food Facts is the most useful next step.
- Recipes built from other foods, micronutrients beyond fiber, sugar, and sodium, and more than one person per deploy.
- OAuth. Agents use bearer tokens. Clients that only accept OAuth for remote MCP (such as claude.ai custom connectors) need the OAuth provider from `@cloudflare/workers-oauth-provider` later.
- Rate limiting. A copy belongs to one person and their own agents.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Runtime | Cloudflare Worker, TypeScript | Free plan, no servers, the Deploy to Cloudflare button. |
| Storage | D1 (SQLite) | The data is small, relational rows: entries, foods, goals, weights. Sums and date ranges are plain SQL. |
| MCP | `@modelcontextprotocol/server` with `createMcpHandler` from `agents` | Stateless streamable HTTP at `/mcp`, the same pair HiveAttic uses. No Durable Object is needed. |
| Validation | zod | One schema per tool validates REST input and becomes the MCP input schema. |
| Tests | vitest with `@cloudflare/vitest-plugin` | Tests run in workerd against a real local D1 with the migrations applied. |

HiveAttic also uses R2, a Durable Object, and a queue, because its source of truth is Markdown files and writes must be serialized. HivePantry has neither need. Each log entry is an independent insert, and the only uniqueness rules (one live food per name and brand, one entry per idempotency key) are unique indexes in D1. Fewer bindings also make the one-click deploy simpler and keep it inside the free plan.

## Layout

- `src/index.ts` Worker entry
- `src/http.ts` routing, REST, admin routes, error envelope
- `src/mcp.ts` MCP server built from the tool list
- `src/tools.ts` the one list of tools, shared by MCP and REST
- `src/service.ts` tool logic and SQL
- `src/schemas.ts` zod input schemas
- `src/auth.ts`, `src/admin.ts` tokens, scopes, agents
- `src/time.ts` time zone and day math
- `src/console.ts`, `src/console.html` the owner console
- `src/brand.ts` product name, slug, token prefix
- `migrations/` D1 schema
- `scripts/deploy.ts` what the button and Workers Builds run
- `test/` vitest suites

## Data model

All nutrient columns hold amounts for one serving. A total is `servings x per-serving amount`. Calories, protein, carbs, and fat are required, so every entry counts toward totals. Fiber, sugar, and sodium are optional and are `null` when unknown, which is different from zero.

| Table | Holds | Key points |
| --- | --- | --- |
| `foods` | The food library | Per-serving nutrients, serving size and unit, optional `serving_grams` (enables logging by grams), barcode, `log_count` and `last_logged_at` for "usual foods" ranking. A partial unique index on lowercased name and brand keeps one live food per name and brand. Deletes are soft. |
| `entries` | The food log | `local_date` (the day it counts toward), optional `consumed_at`, `meal`, `servings`, and a snapshot of the per-serving nutrients copied from the food at log time. `agent_id` records who logged it. Unique `(agent_id, idempotency_key)`. Deletes are soft. |
| `goals` | Daily targets | One row per `effective_from` day. The latest row on or before a day applies to that day, so changing goals never rewrites history. `null` means no target. |
| `weights` | Weigh-ins | Stored in kg, with optional body fat percent. Unique `(agent_id, idempotency_key)`. |
| `agents`, `tokens` | Access | Tokens are stored as SHA-256 hashes with scopes `read` and `write`. |

### Days and time zone

`PANTRY_TZ` is an IANA zone, set on the deploy form (default `UTC`). An entry's `local_date` is the day in that zone. A caller can send `date` (a past day, no time), `consumed_at` (an ISO time, which sets the day in the zone), or neither (now). When the caller sends no `meal`, it comes from the local hour: breakfast 04-11, lunch 11-15, dinner 17-22, otherwise snack; an entry with a date and no time is `other`. An unknown zone answers 500 `misconfigured` rather than filing entries on the wrong day.

## Tools

The tools are the product. They are listed once in `src/tools.ts`; MCP registers each one and REST serves each at `POST /v1/tools/<name>`. Tool names carry no brand, so a rename does not break agents.

| Tool | Scope | What it does |
| --- | --- | --- |
| `whoami` | read | Agent id, scopes, time zone, today's date |
| `guide` | read | How to use the tools (also sent as the MCP server instructions) |
| `search_foods` | read | Match words in name and brand, or an exact barcode. Empty query lists the most-logged foods. |
| `save_food` | write | Create or update a food. Same name and brand updates it; fields not sent keep their value. |
| `delete_food` | write | Soft-delete a food. Logged entries keep their snapshot. |
| `log_food` | write | Log by `food_id`, or by name with nutrients (optionally `save_food`). Servings or grams. Returns the entry and the day's totals and remaining goals. |
| `update_entry` | write | Change servings, grams, meal, day, time, or note |
| `delete_entry` | write | Soft-delete an entry |
| `get_day` | read | One day by meal, totals, goals, remaining |
| `get_trends` | read | Daily totals over a range, average per logged day, average versus goal |
| `get_goals`, `set_goals` | read, write | Goals for a day; set from a day onward, merged with current goals unless `replace` |
| `log_weight`, `get_weights`, `delete_weight` | write, read, write | Weigh-ins in kg or lb, change since the previous one, range summary |

Each reply is `{ ok: true, data }` or `{ ok: false, error: { code, message, issues? } }`. Over MCP the same JSON is the tool's text content, and an error sets `isError`.

## Auth

- `ADMIN_TOKEN` is a Worker secret, asked for by the deploy form, at least 16 characters. It is the owner: it can call every tool and the `/v1/admin` routes, and it signs in to the console.
- Optionally, the owner signs in with Google (or another login) through Cloudflare Access instead. When `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, a verified Access JWT (header, or `CF_Authorization` cookie on same-origin requests) is the owner. The Deploy button cannot create an Access application, so this is a step after the deploy and `ADMIN_TOKEN` stays as the first-login fallback. See `docs/deploy.md`.
- Agent tokens are minted by the admin (console or `POST /v1/admin/tokens`). A token is `hp_<agent>_<43 random chars>`, 256 bits of entropy, shown once. D1 stores only its SHA-256. At that entropy a hash cannot be reversed, so unlike HiveAttic there is no pepper secret to generate or rotate.
- Scopes are `read` and `write`. All agents of a copy act for the same person, so any writer can fix any entry; `agent_id` on each row records who wrote it.
- Revoking a token or disabling an agent takes effect on the next request (no auth cache).
- `/mcp` without a valid token answers 401 with `WWW-Authenticate: Bearer`.

## Deploy flow

1. The **Deploy to Cloudflare** button copies the repository into the owner's GitHub account and connects it to Workers Builds.
2. It reads `wrangler.jsonc`. The config names the D1 database but no `database_id`, so the deploy creates it. `package.json` `cloudflare.bindings` gives the form its help text for `ADMIN_TOKEN` (required by `secrets.required`) and `PANTRY_TZ`.
3. Workers Builds runs `pnpm run deploy` (`scripts/deploy.ts`): apply migrations if the database exists, `wrangler deploy` with `GIT_SHA`, then apply migrations again (the first deploy creates the database during `wrangler deploy`).
4. `.github/workflows/sync-upstream.yml` fast-forwards the copy's `main` to this repository once a day. The push triggers Workers Builds, which applies new migrations before the new code goes live.

The button can only read a public repository, so this repository must be public for the button to work.

CI (`.github/workflows/test.yml`) runs typecheck and tests, and fails if `wrangler.jsonc` names a `database_id`.

## Renaming

The name is kept in few places so a rename is quick:

1. `src/brand.ts`: `APP_NAME`, `APP_SLUG`, `TOKEN_PREFIX`.
2. `package.json` `name`, and `wrangler.jsonc` `name` and `database_name` (also the `--local` database name in the `dev` script).
3. `UPSTREAM` and the `github.repository` check in `.github/workflows/sync-upstream.yml`, and the button URL in `README.md`.
4. Prose in `README.md` and `docs/`.

A deployed copy that changes its worker or database name gets a new, empty worker or database, so existing copies should keep their names.
