# Architecture

HivePantry is a food log. AI agents write to it and read from it. One Cloudflare Worker serves MCP, a small REST API, and an owner console. One D1 database keeps all of the data. A button deploys HivePantry into the Cloudflare account of the owner. HiveAttic uses the same deploy method.

## Goals and non-goals

Goals:

- An agent logs a meal with one call. The same reply shows the totals for the day and the quantity that remains for each goal.
- One click deploys a copy that operates on the Cloudflare free plan. The deploy has one necessary setting, `ADMIN_TOKEN`.
- An agent always reads the same numbers for the same day. A change to a saved food does not change earlier entries.
- A retry is safe. Each write accepts an idempotency key.

These items are not in this version. Each item is possible in a subsequent version:

- A nutrition database. Agents estimate the values from their own knowledge or from a label. Then they save the food. A barcode search in Open Food Facts is the most useful next item.
- Recipes that contain other foods.
- Micronutrients other than fiber, sugar, and sodium.
- More than one person for each deploy.
- OAuth. Agents use bearer tokens. Some clients accept only OAuth for remote MCP, for example claude.ai custom connectors. For these clients, it is necessary to add the OAuth provider from `@cloudflare/workers-oauth-provider`.
- Rate limits. One person and their own agents use each copy.

## Stack

| Part | Selection | Reason |
| --- | --- | --- |
| Runtime | Cloudflare Worker, TypeScript | The free plan, no servers, and the Deploy to Cloudflare button. |
| Storage | D1 (SQLite) | The data is small relational rows: entries, foods, goals, and weights. Plain SQL calculates sums and date ranges. |
| MCP | `@modelcontextprotocol/server` with `createMcpHandler` from `agents` | Streamable HTTP without sessions at `/mcp`. HiveAttic uses the same two packages. A Durable Object is not necessary. |
| Validation | zod | One schema for each tool validates the REST input. The same schema is the MCP input schema. |
| Tests | vitest with `@cloudflare/vitest-plugin` | The tests run in workerd with a real local D1 and the migrations. |

HiveAttic also uses R2, a Durable Object, and a queue. HiveAttic keeps its data as Markdown files and must write them in sequence. HivePantry does not have these requirements. Each log entry is an independent insert. D1 unique indexes enforce the two uniqueness rules:

- One active food for each name and brand.
- One entry for each idempotency key.

With fewer bindings, the one-click deploy is simpler and stays on the free plan.

## Layout

- `src/index.ts`: the Worker entry point
- `src/http.ts`: routes, REST, admin routes, and the error envelope
- `src/mcp.ts`: the MCP server, made from the list of tools
- `src/tools.ts`: the one list of tools for MCP and REST
- `src/service.ts`: the tool logic and the SQL
- `src/schemas.ts`: the zod input schemas
- `src/auth.ts`, `src/admin.ts`: tokens, scopes, and agents
- `src/access.ts`: the optional Cloudflare Access sign-in
- `src/time.ts`: the time zone and day calculations
- `src/console.ts`, `src/console.html`: the owner console
- `src/brand.ts`: the product name, the slug, and the token prefix
- `migrations/`: the D1 schema
- `scripts/deploy.ts`: the script that the button and Workers Builds run
- `test/`: the vitest suites

## Data model

Each nutrient column keeps the quantity for one serving. A total is the number of servings multiplied by the quantity for one serving.

Calories, protein, carbohydrates, and fat are necessary. Thus, each entry adds to the totals. Fiber, sugar, and sodium are optional. If the value is not known, it is `null`. `null` is not the same as zero.

| Table | Contents | Important points |
| --- | --- | --- |
| `foods` | The food library | Nutrients for one serving, the serving size and unit, and an optional `serving_grams`. With `serving_grams`, agents can log by grams. It also keeps the barcode, and `log_count` and `last_logged_at` to sort the frequent foods first. A partial unique index on the lowercase name and brand permits one active food for each name and brand. A delete only marks the row as deleted. |
| `entries` | The food log | `local_date` (the day that the entry counts for), an optional `consumed_at`, `meal`, `servings`, and a copy of the nutrients for one serving. The copy comes from the food at the time of the log. `agent_id` shows the agent that logged the entry. `(agent_id, idempotency_key)` is unique. A delete only marks the row as deleted. |
| `goals` | Daily targets | One row for each `effective_from` day. The last row on or before a day applies to that day. Thus, a goal change does not change earlier days. `null` means no target. |
| `weights` | Weight measurements | The weight in kg, and an optional body fat percentage. `(agent_id, idempotency_key)` is unique. |
| `agents`, `tokens` | Access | The tokens are SHA-256 hashes with the scopes `read` and `write`. |

### Days and time zone

`PANTRY_TZ` is an IANA time zone. You set it on the deploy form. The default is `UTC`. The `local_date` of an entry is the day in that time zone.

A caller can send one of these values:

- `date`: a day without a time, for example an earlier day.
- `consumed_at`: an ISO time. The worker calculates the day in the time zone.
- No value: the worker uses the current time.

If the caller does not send `meal`, the worker uses the local hour:

- 04 to 11: breakfast
- 11 to 15: lunch
- 17 to 22: dinner
- Other hours: snack
- A date without a time: other

If the time zone is not known, the worker returns 500 `misconfigured`. Thus, it does not put entries on the wrong day.

## Tools

The tools are the product. `src/tools.ts` has the only list of tools. MCP registers each tool. REST serves each tool at `POST /v1/tools/<name>`. The tool names do not contain the product name. Thus, a new product name does not break agents.

| Tool | Scope | Function |
| --- | --- | --- |
| `whoami` | read | Shows the agent ID, the scopes, the time zone, and the current date. |
| `guide` | read | Tells how to use the tools. The MCP server instructions have the same text. |
| `search_foods` | read | Finds words in the name and brand, or an exact barcode. An empty query shows the most frequently logged foods. |
| `save_food` | write | Makes or updates a food. The same name and brand updates the food. Fields that you do not send keep their values. |
| `delete_food` | write | Marks a food as deleted. Logged entries keep their copy of the nutrients. |
| `log_food` | write | Logs a food by `food_id`, or by name with nutrients. `save_food` also saves the food. Accepts servings or grams. Returns the entry, the totals for the day, and the quantity that remains for each goal. |
| `update_entry` | write | Changes the servings, grams, meal, day, time, or note. |
| `delete_entry` | write | Marks an entry as deleted. |
| `get_day` | read | Shows one day by meal, with totals, goals, and the quantity that remains. |
| `get_trends` | read | Shows daily totals for a period, the average for each logged day, and the average compared to the goal. |
| `get_goals`, `set_goals` | read, write | Shows the goals for a day. Sets goals from a day forward. Fields that you do not send keep their values, unless `replace` is true. |
| `log_weight`, `get_weights`, `delete_weight` | write, read, write | Logs weights in kg or lb. Shows the change from the last weight, and a summary for a period. |

Each reply is `{ ok: true, data }` or `{ ok: false, error: { code, message, issues? } }`. With MCP, the same JSON is the text content of the tool reply. If an error occurs, the reply also sets `isError`.

## Authentication

- `ADMIN_TOKEN` is a Worker secret. The deploy form asks for it. It has a minimum of 16 characters. It is the owner. It can call all tools and the `/v1/admin` routes. It signs in to the console.
- The owner can also sign in with Google, or with a different login, through Cloudflare Access. To enable this, set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Then a verified Access JWT is the owner. The worker reads the JWT from the header, or from the `CF_Authorization` cookie on requests from the same origin.
- The Deploy button cannot make an Access application. Thus, you configure Access after the deploy. `ADMIN_TOKEN` stays as the password for the first sign-in. Refer to `docs/deploy.md`.
- The admin makes agent tokens in the console or with `POST /v1/admin/tokens`. A token has the format `hp_<agent>_<43 random characters>`. It has 256 bits of entropy. The reply shows the token one time only.
- D1 keeps only the SHA-256 hash of each token. At this entropy, it is not possible to reverse the hash. Thus, a pepper secret is not necessary. HiveAttic uses a pepper secret.
- The scopes are `read` and `write`. All agents of a copy operate for the same person. Thus, each agent with `write` can correct each entry. The `agent_id` of each row shows the agent that wrote it.
- When you revoke a token or disable an agent, the change applies on the next request. The worker does not keep authentication in a cache.
- A request to `/mcp` without a valid token receives 401 with `WWW-Authenticate: Bearer`.

## Deploy procedure

1. The **Deploy to Cloudflare** button copies the repository into the GitHub account of the owner. It connects the copy to Workers Builds.
2. The button reads `wrangler.jsonc`. The file names the D1 database but does not contain a `database_id`. Thus, the deploy makes the database.
3. `package.json` `cloudflare.bindings` gives the help text on the form for `ADMIN_TOKEN`, `PANTRY_TZ`, and the Access vars. `secrets.required` makes `ADMIN_TOKEN` necessary.
4. Workers Builds runs `pnpm run deploy` (`scripts/deploy.ts`). The script applies the migrations if the database exists. Then it runs `wrangler deploy` with `GIT_SHA`. Then it applies the migrations again, because the first deploy makes the database during `wrangler deploy`.
5. `.github/workflows/sync-upstream.yml` moves the `main` of the copy forward to this repository one time each day. The push starts Workers Builds. Workers Builds applies new migrations before the new code starts.

The button can read only a public repository. Thus, this repository must be public for the button to operate.

CI (`.github/workflows/test.yml`) runs the type check and the tests. CI fails if `wrangler.jsonc` names a `database_id`.

## Rename

Few files contain the product name. Thus, a new name is a quick change:

1. `src/brand.ts`: `APP_NAME`, `APP_SLUG`, and `TOKEN_PREFIX`.
2. `package.json` `name`. In `wrangler.jsonc`, `name` and `database_name`. Also the `--local` database name in the `dev` script.
3. `UPSTREAM` and the `github.repository` check in `.github/workflows/sync-upstream.yml`. The button URL in `README.md`.
4. The text in `README.md` and `docs/`.

**CAUTION:** If a deployed copy changes its worker name or database name, it receives a new, empty worker or database. Thus, do not change the names of existing copies.
