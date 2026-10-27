# API

Every request except `GET /v1/health` and the console needs `Authorization: Bearer <token>`. A token is either the `ADMIN_TOKEN` or an agent token minted by the admin.

Replies are JSON: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message", "issues"? } }`.

| Code | Status | Meaning |
| --- | --- | --- |
| `unauthorized` | 401 | Missing or invalid token |
| `forbidden` | 403 | The token lacks the scope, or the route is admin-only |
| `not_found` | 404 | No such tool, food, entry, weight, token, or agent |
| `invalid` | 400 | Input failed validation; `issues` lists the fields |
| `conflict` | 409 | A save would duplicate another food's name and brand |
| `misconfigured` | 500 | `ADMIN_TOKEN` is missing or short, or `PANTRY_TZ` is unknown |

## MCP

`POST /mcp` speaks MCP over streamable HTTP (stateless). The server's instructions are the `guide` text. Each tool's reply is the JSON envelope above as text content; an error also sets `isError`.

## Tools

Each tool is also `POST /v1/tools/<name>` with its arguments as the JSON body. `GET /v1/tools` lists them. Days are `YYYY-MM-DD` in `PANTRY_TZ`; times are ISO 8601.

| Tool | Arguments |
| --- | --- |
| `whoami` | none |
| `guide` | none |
| `search_foods` | `query?`, `barcode?`, `limit?` (1-50, default 10) |
| `save_food` | `id?`, `name`, `brand?`, `serving_size?`, `serving_unit?`, `serving_grams?`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g?`, `sugar_g?`, `sodium_mg?`, `barcode?`, `notes?` |
| `delete_food` | `id` |
| `log_food` | `food_id`, or `name` + `calories`, `protein_g`, `carbs_g`, `fat_g` (+ optional `brand`, serving fields, `fiber_g`, `sugar_g`, `sodium_mg`, `save_food`); `servings?` or `grams?`; `meal?`; `date?`; `consumed_at?`; `note?`; `idempotency_key?` |
| `update_entry` | `id`, `servings?` or `grams?`, `meal?`, `date?`, `consumed_at?`, `note?` |
| `delete_entry` | `id` |
| `get_day` | `date?` |
| `get_trends` | `from?`, `to?`, `days?` (default 7, at most 366) |
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

Admin token only.

| Route | Body | Does |
| --- | --- | --- |
| `GET /v1/admin/agents` | | Agents with their tokens (no token values) |
| `POST /v1/admin/tokens` | `agent_id`, `name?`, `scopes?` (default `["read","write"]`), `label?` | Makes the agent if new, enables it if disabled, and returns a new token once, with `mcp_url` |
| `DELETE /v1/admin/tokens/<token_id>` | | Revokes one token |
| `DELETE /v1/admin/agents/<agent_id>` | | Disables the agent and revokes all its tokens |

`GET /v1/health` answers `{ status, service, version, git_sha }` to anyone.
