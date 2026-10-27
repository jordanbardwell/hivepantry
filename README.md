# HivePantry

HivePantry is a log of calories and macronutrients for AI agents. Agents record the food that you eat. Agents also read your saved foods, daily totals, and goals through MCP. HivePantry operates in your own Cloudflare account on the free plan. You own the data.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jordanbardwell/hivepantry)

## Functions

- Agents log food from a saved food, or from a name with calories, protein, carbohydrates, and fat.
- Each log reply shows the totals for the day and the quantity that remains for each goal.
- The food library keeps foods that you eat frequently. Agents find a food by name, brand, or barcode. Agents log a food by servings or by grams.
- You can set daily goals for calories, protein, carbohydrates, fat, fiber, sugar, and sodium. A goal change does not change the goals of earlier days.
- Agents show daily totals and trends for a period. Agents also log your body weight in kg or lb.
- Each agent has its own token. A token has read access, or read and write access. Each entry shows the agent that logged it.
- The web console shows the current day and recent trends. You make and revoke agent tokens in the console.

## Deploy

1. Click **Deploy to Cloudflare** above.
2. Sign in to Cloudflare and GitHub.
3. Type an admin password in `ADMIN_TOKEN`. Use a minimum of 16 characters.
4. Keep the password in a safe location.
5. Type your time zone in `PANTRY_TZ`, for example `America/New_York`. If you are not sure, keep `UTC`.
6. Optional: type your email address in `OWNER_EMAIL`. Then you sign in to the console with a code that Cloudflare sends to this address.
7. Wait until the deploy is complete.
8. Open `https://<worker>.<subdomain>.workers.dev/console`.
9. Sign in with the code that Cloudflare sends to your email address. If you did not set `OWNER_EMAIL`, sign in with your `ADMIN_TOKEN`.

The deploy makes the D1 database and applies its schema. Your copy receives the updates from this repository one time each day.

If you set `OWNER_EMAIL`, the deploy puts Cloudflare Access in front of the console only. Agents continue to use their tokens on `/mcp`. The Workers Builds token must have two Access permissions for this step. Refer to [docs/deploy.md](docs/deploy.md#console-sign-in-with-cloudflare-access).

For updates and a manual deploy, refer to [docs/deploy.md](docs/deploy.md).

## Connect an agent

1. In the console, open **Agents**.
2. Type a name for the agent, for example `claude`.
3. Click **Make token**.
4. Copy the token. The console shows the token one time only.
5. Give the agent the MCP address `https://<worker>.<subdomain>.workers.dev/mcp`.
6. Give the agent the token as a bearer token. For Claude Code, use this command:

   ```sh
   claude mcp add --transport http pantry https://<worker>.<subdomain>.workers.dev/mcp \
     --header "Authorization: Bearer <agent token>"
   ```

7. Tell the agent to call the `guide` tool first. The `guide` tool tells the agent how to use the other tools.

The **Connect** page in the console shows more configuration examples.

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
