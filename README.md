# HivePantry

HivePantry is a log of calories and macronutrients for AI agents. Agents record the food that you eat. Agents also read your saved foods, daily totals, and goals through MCP. HivePantry operates in your own Cloudflare account on the free plan. You own the data.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jordanbardwell/hivepantry)

## Functions

- Agents log food from a saved food, or from a name with calories, protein, carbohydrates, and fat.
- Each log reply shows the totals for the day and the quantity that remains for each goal.
- The food library keeps foods that you eat frequently. Agents find a food by name, brand, or barcode. Agents log a food by servings or by grams.
- Agents save recipes from their ingredients and the weight of the cooked batch. Then you weigh your portion, and the agent logs it by grams. The recipe shows the nutrients for one serving and for 100 g, and the quantity that remains of the batch.
- You can set daily goals for calories, protein, carbohydrates, fat, fiber, sugar, and sodium. A goal change does not change the goals of earlier days.
- Agents show daily totals and trends for a period. Agents also log your body weight in kg or lb. The console shows the weight in lb.
- Each agent has its own token. A token has read access, or read and write access. Each entry shows the agent that logged it.
- The web console shows the current day, the calories for each day, and your weight. You can find a saved food or recipe in the console and log it. You make and revoke agent tokens in the console. The console has a dark mode and a light mode. Dark mode is the default.

## Deploy

1. Click **Deploy to Cloudflare** above.
2. Sign in to Cloudflare and GitHub.
3. Type an admin password in `ADMIN_TOKEN`. Use a minimum of 8 characters. This is the only setting.
4. Keep the password in a safe location.
5. Click **Create and deploy**. Wait until the deploy is complete.
6. Open `https://<worker>.<subdomain>.workers.dev/console`.
7. Sign in with your `ADMIN_TOKEN`.

Your browser or password manager can keep the `ADMIN_TOKEN` when you sign in.

The console uses the time zone of your browser at the first sign-in. The deploy makes the D1 database and applies its schema. Your copy does not receive updates from this repository automatically. To receive them, connect your copy one time and set the repository variable `SYNC_UPSTREAM` to `true`. Refer to [docs/deploy.md](docs/deploy.md#updates).

Optional: to sign in to the console with a code that Cloudflare sends to your email address, refer to [docs/deploy.md](docs/deploy.md#console-sign-in-with-cloudflare-access).

For updates and a manual deploy, refer to [docs/deploy.md](docs/deploy.md).

## Connect an agent

1. In the console, open **Agents**.
2. Type a name for the agent, for example `Claude Code`.
3. Select the access: **Read and write** or **Read only**.
4. Click **Make token**.
5. Click **Copy setup prompt**.
6. Paste the prompt to your AI agent. The prompt has the MCP address, the token, the configuration for Claude Code and for JSON settings files, and the rules to log food. The agent connects, examines the connection, and tells you what it will log.

The prompt holds the token. Paste it only to the agent.

To see the token or the prompt again, click **Show** in the **Agents** table. To change the access of a token, select a different value in the **Access** column. A token that you made before this function has no **Show** button. Make a new token for that agent, then revoke the old token.

The **Connect** page in the console shows more configuration examples. Each example has a **Copy** button.

Each MCP tool is also a REST call at `POST /v1/tools/<name>` with a JSON body. Refer to [docs/api.md](docs/api.md).

## Documentation

- [docs/architecture.md](docs/architecture.md): the stack, the data model, the tools, authentication, and the deploy procedure
- [docs/api.md](docs/api.md): the MCP tools and the REST routes
- [docs/deploy.md](docs/deploy.md): the one-click deploy, updates, the console sign-in, and the manual deploy

## Development

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev          # local worker and local D1 at http://localhost:8787
pnpm typecheck
pnpm test         # vitest in the Workers runtime with a local D1
```

## License

This repository does not have a license at this time.
