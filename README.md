# HivePantry

HivePantry is a calorie and macronutrient log for AI agents. Agents log what you eat, look up your saved foods, and read your daily totals and goals over MCP. It runs in your own Cloudflare account, on the free plan, and you own the data.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jordanbardwell/hivepantry)

## What it does

- Agents log food by saved food, or by name with calories, protein, carbs, and fat. Every log returns the day's totals and what is left of each goal.
- A food library: save a food once, find it later by name, brand, or barcode, and log it by servings or grams.
- Daily goals for calories, protein, carbs, fat, fiber, sugar, and sodium, with history.
- Daily, weekly, and longer trends, and body weight in kg or lb.
- Each agent gets its own token, read-only or read and write. Every entry records which agent logged it.
- A web console shows today and recent trends, and makes and revokes agent tokens.

## Deploy

1. Click **Deploy to Cloudflare** above. Sign in to Cloudflare and GitHub.
2. Enter an admin password in `ADMIN_TOKEN`. Use 16 characters or more, and keep it somewhere safe.
3. Set `PANTRY_TZ` to your time zone, for example `America/New_York`. Days and daily totals follow it.
4. Wait for the deploy to finish.
5. Open `https://<worker>.<subdomain>.workers.dev/console` and sign in with your `ADMIN_TOKEN`.

The deploy creates the D1 database and applies its schema. Your copy gets updates from this repository once a day. See [docs/deploy.md](docs/deploy.md) for updates and a deploy by hand.

## Connect an agent

1. In the console, open **Agents**, enter a name such as `claude`, and click **Make token**. Copy the token; it is shown once.
2. Give the agent the MCP address `https://<worker>.<subdomain>.workers.dev/mcp` with the token as a bearer token. For Claude Code:

   ```sh
   claude mcp add --transport http pantry https://<worker>.<subdomain>.workers.dev/mcp \
     --header "Authorization: Bearer <agent token>"
   ```

3. The agent can call `guide` to learn the tools. The **Connect** tab in the console has more config snippets.

Every MCP tool is also a REST call at `POST /v1/tools/<name>` with a JSON body. See [docs/api.md](docs/api.md).

## Documentation

- [docs/architecture.md](docs/architecture.md): stack, data model, tools, auth, and deploy flow
- [docs/api.md](docs/api.md): MCP tools and REST routes
- [docs/deploy.md](docs/deploy.md): one-click deploy, updates, and deploy by hand

## Development

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev          # local worker with a local D1 at http://localhost:8787
pnpm typecheck
pnpm test         # vitest in the Workers runtime, with a local D1
```

## License

This repository does not have a license yet.
