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
- Micronutrients other than fiber, sugar, and sodium.
- More than one person for each deploy.
- OAuth. Agents use bearer tokens. Some clients accept only OAuth for remote MCP, for example claude.ai custom connectors. For these clients, it is necessary to add the OAuth provider from `@cloudflare/workers-oauth-provider`.
- Rate limits for agent tokens. One person and their own agents use each copy. Only tries of `ADMIN_TOKEN` have a limit.

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
- `scripts/access-setup.ts`: the deploy step that makes the Access application for the console
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
| `recipe_ingredients` | The ingredients of each recipe | A recipe is a row in `foods`. `recipe_servings` is not `null` for a recipe. Each ingredient row keeps the amount (`servings`) and a copy of the nutrients for one serving of the ingredient. The copy comes from the saved food at the time of the save, as for entries. A new list of ingredients replaces the old rows. |
| `entries` | The food log | `local_date` (the day that the entry counts for), an optional `consumed_at`, `meal`, `servings`, and a copy of the nutrients for one serving. The copy comes from the food at the time of the log. `agent_id` shows the agent that logged the entry. `(agent_id, idempotency_key)` is unique. A delete only marks the row as deleted. |
| `goals` | Daily targets | One row for each `effective_from` day. The last row on or before a day applies to that day. Thus, a goal change does not change earlier days. `null` means no target. |
| `weights` | Weight measurements | The weight in kg, and an optional body fat percentage. `(agent_id, idempotency_key)` is unique. |
| `agents`, `tokens` | Access | The tokens are SHA-256 hashes with the scopes `read` and `write`. |

### Recipes

A recipe is a saved food that has a list of ingredients. Thus, `search_foods`, `log_food`, `update_entry`, and `delete_food` operate on recipes as on other foods.

`save_recipe` calculates the nutrients of the recipe from the ingredients:

1. The worker adds the nutrients of all ingredients. This sum is the nutrients of the full batch.
2. The worker divides the batch by `servings`. The result goes in the nutrient columns of the recipe.
3. `recipe_total_grams` is the weight of the batch after cooking. `serving_grams` is `recipe_total_grams` divided by `servings`. Thus, an agent can log a recipe by grams.

If the caller does not send `servings`, and the weight of the batch is known, one serving is 100 g. The unit is then `100 g`. A new weight keeps servings of 100 g. If the weight is not known, one serving is the full batch. The reply shows a warning in the two cases. Thus, an agent does not log the full batch as "one serving" by mistake.

Cooking changes the weight of food. For example, rice absorbs water, and meat loses water. Thus, the weight of the ingredients is not the weight of the batch. If the caller does not send `total_grams`, the worker uses the sum of the ingredient weights. The reply then shows a warning.

If only some ingredients have a value for fiber, sugar, or sodium, the sum is too low. The reply shows these nutrients in `incomplete_nutrients` and as a warning.

An ingredient can be another recipe. The ingredient keeps a copy of the nutrients. Thus, a change to the other recipe does not change this recipe. A recipe cannot contain itself.

Only `save_recipe` can change the nutrients of a recipe. `save_food` returns 409 `conflict` for a recipe.

`recipe_batch_at` is the start time of the current batch. A `save_recipe` call with `ingredients` or `total_grams` starts a new batch. `get_recipe` adds the entries of the recipe that the person ate after this time. Thus, it shows the grams and servings that remain. The worker uses `consumed_at` of each entry. If an entry has only a day, it counts if the day is on or after the day of the batch. Thus, a meal from the old batch that an agent logs late does not count against the new batch. The worker keeps only one batch for each recipe. When a new batch starts, the remainder of the old batch is not counted.

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
| `search_foods` | read | Finds words in the name and brand, or an exact barcode. An empty query shows the most frequently logged foods. `kind` shows only recipes or only plain foods. |
| `save_food` | write | Makes or updates a food. The same name and brand updates the food. Fields that you do not send keep their values. |
| `delete_food` | write | Marks a food or a recipe as deleted. Logged entries keep their copy of the nutrients. |
| `save_recipe` | write | Makes or updates a recipe from its ingredients and the weight of the cooked batch. The same name updates the recipe. Fields that you do not send keep their values. Returns the recipe and warnings. |
| `get_recipe` | read | Shows the ingredients, the totals of the batch, the nutrients for one serving and for 100 g, and the quantity that remains of the current batch. |
| `log_food` | write | Logs a food by `food_id`, or by name with nutrients. `save_food` also saves the food. Accepts servings or grams. Returns the entry, the totals for the day, and the quantity that remains for each goal. If the entry has more than 2000 kcal, the reply also has `warnings`. |
| `update_entry` | write | Changes the servings, grams, meal, day, time, or note. |
| `delete_entry` | write | Marks an entry as deleted. |
| `get_day` | read | Shows one day by meal, with totals, goals, and the quantity that remains. |
| `get_trends` | read | Shows daily totals for a period, the average for each logged day, and the average difference from the goal. Each day uses the goal that applies on that day. |
| `get_goals`, `set_goals` | read, write | Shows the goals for a day. Sets goals from a day forward. Fields that you do not send keep their values, unless `replace` is true. |
| `log_weight`, `get_weights`, `delete_weight` | write, read, write | Logs weights in kg or lb. Shows the change from the last weight, and a summary for a period. |

Each reply is `{ ok: true, data }` or `{ ok: false, error: { code, message, issues? } }`. With MCP, the same JSON is the text content of the tool reply. If an error occurs, the reply also sets `isError`.

## Authentication

- `ADMIN_TOKEN` is a Worker secret. The deploy form asks for it. It has a minimum of 16 characters. It is the owner. It operates only on the console API and the `/v1/admin` routes. On `/mcp` and `/v1/tools`, it receives 403. Thus, an agent configuration cannot contain the owner password.
- A person selects `ADMIN_TOKEN`, so an attacker can try to guess it. The `AUTH_LIMITER` binding permits 120 tries for each IP address in one minute. Each console request is a try, so the limit is more than the console uses. `ADMIN_TOKEN` has a minimum of 16 characters, so 120 guesses in one minute cannot find it. The worker examines agent tokens first. Agent tokens have 256 bits of entropy, so they do not use the limit.
- The owner can also sign in to the console through Cloudflare Access. If `OWNER_EMAIL` is set, the deploy script makes an Access application for `<worker>.<subdomain>.workers.dev/console` only (`scripts/access-setup.ts`). The script sets `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` on the worker.
- The console calls the API at `/console/api/`, which the worker maps to `/v1/`. Thus, Access covers the console page and its API calls. `/mcp` and `/v1` are not in the Access application, so agents continue to use bearer tokens.
- The worker verifies the Access JWT in the `Cf-Access-Jwt-Assertion` header. It also examines that the email is in `OWNER_EMAIL`. A verified JWT is the owner. The worker accepts the JWT only on `/console/api/`. A change with a JWT must have an `Origin` header that is the address of the worker. `ADMIN_TOKEN` continues to operate as a second sign-in method.
- The admin makes agent tokens in the console or with `POST /v1/admin/tokens`. A token has the format `hp_<agent>_<43 random characters>`. It has 256 bits of entropy. The reply shows the token one time only. An optional `expires_in_days` sets an expiry time. After that time, the token does not operate.
- D1 keeps only the SHA-256 hash of each token. At this entropy, it is not possible to reverse the hash. Thus, a pepper secret is not necessary. HiveAttic uses a pepper secret.
- The scopes are `read` and `write`. All agents of a copy operate for the same person. Thus, each agent with `write` can correct each entry. The `agent_id` of each row shows the agent that wrote it. `deleted_by` shows the agent that deleted it.
- When you revoke a token or disable an agent, the change applies on the next request. The worker does not keep authentication in a cache.
- A request to `/mcp` without a valid token receives 401 with `WWW-Authenticate: Bearer`.

## Deploy procedure

1. The **Deploy to Cloudflare** button copies the repository into the GitHub account of the owner. It connects the copy to Workers Builds.
2. The button reads `wrangler.jsonc`. The file names the D1 database but does not contain a `database_id`. Thus, the deploy makes the database.
3. `package.json` `cloudflare.bindings` gives the help text on the form for `ADMIN_TOKEN`, `PANTRY_TZ`, and `OWNER_EMAIL`. `secrets.required` makes `ADMIN_TOKEN` necessary.
4. Workers Builds runs `pnpm run deploy` (`scripts/deploy.ts`). The script applies the migrations if the database exists. Then it runs `wrangler deploy` with `GIT_SHA`. Then it applies the migrations again, because the first deploy makes the database during `wrangler deploy`.
5. `.github/workflows/sync-upstream.yml` moves the `main` of the copy forward to this repository one time each day. It operates only if the owner of the copy sets the repository variable `SYNC_UPSTREAM` to `true`. An update runs code from this repository with the data of the copy. Thus, the owner of the copy must decide to accept updates. The push starts Workers Builds. Workers Builds applies new migrations before the new code starts.

The button can read only a public repository. Thus, this repository must be public for the button to operate.

CI (`.github/workflows/test.yml`) runs the type check and the tests. CI fails if `wrangler.jsonc` names a `database_id`.

## Rename

Few files contain the product name. Thus, a new name is a quick change:

1. `src/brand.ts`: `APP_NAME`, `APP_SLUG`, and `TOKEN_PREFIX`.
2. `package.json` `name`. In `wrangler.jsonc`, `name` and `database_name`. Also the `--local` database name in the `dev` script.
3. `UPSTREAM` and the `github.repository` check in `.github/workflows/sync-upstream.yml`. The button URL in `README.md`.
4. The text in `README.md` and `docs/`.

**CAUTION:** If a deployed copy changes its worker name or database name, it receives a new, empty worker or database. Thus, do not change the names of existing copies.
