# API

Each request must have the header `Authorization: Bearer <token>`. These requests are the exceptions: `GET /v1/health`, the console page, and requests with a Cloudflare Access sign-in. The token is the `ADMIN_TOKEN` or an agent token. The admin makes the agent tokens.

Each reply is JSON with one of these two formats:

- `{ "ok": true, "data": ... }`
- `{ "ok": false, "error": { "code", "message", "issues"? } }`

| Code | Status | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | The token is missing or not valid. |
| `forbidden` | 403 | The token does not have the scope, or only the admin can use the route. |
| `not_found` | 404 | The tool, food, entry, weight, token, or agent does not exist. |
| `invalid` | 400 | The input is not correct. `issues` shows the incorrect fields. |
| `conflict` | 409 | Another food has the same name and brand. |
| `misconfigured` | 500 | `ADMIN_TOKEN` is missing or too short, or `PANTRY_TZ` is not a known time zone. |

## MCP

`POST /mcp` uses MCP over streamable HTTP without sessions. The server instructions are the text of the `guide` tool. Each tool reply is the JSON envelope above, as text content. If an error occurs, the reply also sets `isError`.

## Tools

Each tool is also available at `POST /v1/tools/<name>`. Send the arguments as the JSON body. `GET /v1/tools` shows the list of tools.

Days have the format `YYYY-MM-DD` in the `PANTRY_TZ` time zone. Times have the ISO 8601 format.

| Tool | Arguments |
| --- | --- |
| `whoami` | none |
| `guide` | none |
| `search_foods` | `query?`, `barcode?`, `limit?` (1 to 50, default 10) |
| `save_food` | `id?`, `name`, `brand?`, `serving_size?`, `serving_unit?`, `serving_grams?`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g?`, `sugar_g?`, `sodium_mg?`, `barcode?`, `notes?` |
| `delete_food` | `id` |
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

Example:

```sh
curl -X POST "$BASE/v1/tools/log_food" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"name":"Banana","calories":105,"protein_g":1.3,"carbs_g":27,"fat_g":0.4,"idempotency_key":"banana-2026-10-27"}'
```

## Admin routes

Only the admin can use these routes.

| Route | Body | Result |
| --- | --- | --- |
| `GET /v1/admin/agents` | | Shows the agents and their tokens. It does not show token values. |
| `POST /v1/admin/tokens` | `agent_id`, `name?`, `scopes?` (default `["read","write"]`), `label?` | Makes the agent if it does not exist. Enables the agent if it is disabled. Returns a new token and `mcp_url`. The reply shows the token one time only. |
| `DELETE /v1/admin/tokens/<token_id>` | | Revokes one token. |
| `DELETE /v1/admin/agents/<agent_id>` | | Disables the agent and revokes all of its tokens. |

A token is not necessary for `GET /v1/health`. It returns `{ status, service, version, git_sha }`.
