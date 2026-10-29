# API

Each request must have the header `Authorization: Bearer <token>`. These requests are the exceptions: `GET /v1/health`, the console page, and console requests with a Cloudflare Access sign-in. The token is an agent token or the `ADMIN_TOKEN`. The admin makes the agent tokens.

`ADMIN_TOKEN` operates only on the console API (`/console/api/`) and on `/v1/admin`. On `/mcp` and `/v1/tools`, it receives 403. Give each agent its own agent token.

Each IP address can try `ADMIN_TOKEN` a maximum of 30 times in one minute. More tries receive 429. Agent tokens do not have this limit.

The maximum size of a request body is 64 KB. This limit applies to `/mcp`, `/v1`, and the console API. A larger body receives 400 with the code `invalid`.

Each reply is JSON with one of these two formats:

- `{ "ok": true, "data": ... }`
- `{ "ok": false, "error": { "code", "message", "issues"? } }`

| Code | Status | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | The token is missing or not valid. |
| `forbidden` | 403 | The token does not have the scope, only the admin can use the route, or `ADMIN_TOKEN` is not permitted on the route. |
| `not_found` | 404 | The tool, food, recipe, entry, weight, token, or agent does not exist. |
| `invalid` | 400 | The input is not correct. `issues` shows the incorrect fields. |
| `conflict` | 409 | Another food or recipe has the same name and brand, or `save_food` tried to change a recipe. |
| `rate_limited` | 429 | Too many tries of `ADMIN_TOKEN` from one IP address. Wait one minute. |
| `misconfigured` | 500 | `ADMIN_TOKEN` is missing or too short, or `PANTRY_TZ` is not a known time zone. |

## MCP

`POST /mcp` uses MCP over streamable HTTP without sessions. The server instructions are the text of the `guide` tool. Each tool reply is the JSON envelope above, as text content. If an error occurs, the reply also sets `isError`. If the arguments do not agree with the input schema of the tool, the MCP library sends the reply. That reply is plain text, not the JSON envelope, and it also sets `isError`.

## Tools

Each tool is also available at `POST /v1/tools/<name>`. Send the arguments as the JSON body. `GET /v1/tools` shows the list of tools.

Days have the format `YYYY-MM-DD` in the `PANTRY_TZ` time zone. Times have the ISO 8601 format.

| Tool | Arguments |
| --- | --- |
| `whoami` | none |
| `guide` | none |
| `search_foods` | `query?`, `barcode?`, `kind?` (`food` or `recipe`), `limit?` (1 to 50, default 10) |
| `save_food` | `id?`, `name`, `brand?`, `serving_size?`, `serving_unit?`, `serving_grams?`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g?`, `sugar_g?`, `sodium_mg?`, `barcode?`, `notes?` |
| `delete_food` | `id` |
| `save_recipe` | `id?`, `name`, `ingredients` (1 to 100, optional on an update), `total_grams?`, `servings?`, `serving_unit?`, `notes?` |
| `get_recipe` | `id` |
| `log_food` | `food_id`, or `name` with `calories`, `protein_g`, `carbs_g`, and `fat_g`. Optional: `brand`, the serving fields, `fiber_g`, `sugar_g`, `sodium_mg`, `save_food`. Then `servings?` or `grams?`, `meal?`, `date?`, `consumed_at?`, `note?`, `idempotency_key?` |
| `update_entry` | `id`, `servings?` or `grams?`, `meal?`, `date?`, `consumed_at?`, `note?` |
| `delete_entry` | `id` |
| `get_day` | `date?` |
| `get_trends` | `from?`, `to?`, `days?` (default 7, maximum 366) |
| `get_goals` | `date?` |
| `set_goals` | `calories?`, `protein_g?`, `carbs_g?`, `fat_g?`, `fiber_g?`, `sugar_g?`, `sodium_mg?`, `effective_from?`, `replace?` |
| `log_weight` | `weight`, `unit` (`kg` or `lb`), `body_fat_pct?`, `date?`, `measured_at?`, `note?`, `idempotency_key?` |
| `get_weights` | `from?`, `to?`, `days?` (default 30) |
| `delete_weight` | `id` |

Each item in `ingredients` has the same food fields as `log_food`: `food_id`, or `name` with `calories`, `protein_g`, `carbs_g`, and `fat_g` for one serving. Optional: `brand`, the serving fields, `fiber_g`, `sugar_g`, `sodium_mg`, `save_food`. Then `servings?` or `grams?`, and `note?`.

`total_grams` is the weight of the full batch after cooking. Do not include the weight of the pot. With `total_grams`, you can log the recipe by grams with `log_food`.

If you do not send `servings`, one serving is 100 g when the weight is known. If the weight is not known, one serving is the full batch. To rename a recipe, send its `id`. If you do not send the `id`, `save_recipe` makes a second recipe.

If one `log_food` entry has more than 2000 kcal, the reply also has `warnings`. Examine the amount.

The `log_food` and `get_day` entries also show `grams`. This value is `null` if the food does not have `serving_grams`.

Example:

```sh
curl -X POST "$BASE/v1/tools/log_food" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"name":"Banana","calories":105,"protein_g":1.3,"carbs_g":27,"fat_g":0.4,"idempotency_key":"banana-2026-10-27"}'
```

Recipe example. The batch weighs 5000 g after cooking. Then you log 500 g of it:

```sh
curl -X POST "$BASE/v1/tools/save_recipe" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"name":"Chicken and rice","total_grams":5000,"ingredients":[
        {"name":"Chicken thigh, raw","serving_grams":100,"calories":177,"protein_g":24,"carbs_g":0,"fat_g":8.4,"grams":1500},
        {"name":"White rice, dry","serving_grams":100,"calories":365,"protein_g":7.1,"carbs_g":80,"fat_g":0.7,"grams":1000}]}'
curl -X POST "$BASE/v1/tools/log_food" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"food_id":"<recipe id>","grams":500,"meal":"lunch"}'
```

## Admin routes

Only the admin can use these routes.

| Route | Body | Result |
| --- | --- | --- |
| `GET /v1/admin/agents` | | Shows the agents and their tokens. It does not show token values. |
| `POST /v1/admin/tokens` | `agent_id`, `name?`, `scopes?` (default `["read","write"]`), `label?`, `expires_in_days?` (1 to 3650, default no expiry) | Makes the agent if it does not exist. Enables the agent if it is disabled. Returns a new token, `expires_at`, and `mcp_url`. The reply shows the token one time only. |
| `DELETE /v1/admin/tokens/<token_id>` | | Revokes one token. |
| `DELETE /v1/admin/agents/<agent_id>` | | Disables the agent and revokes all of its tokens. |

A token is not necessary for `GET /v1/health`. It returns `{ status, service, version, git_sha }`.
