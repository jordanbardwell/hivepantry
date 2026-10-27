# Deploy

This document tells you how to deploy, update, and configure a copy of HivePantry.

## Deploy to Cloudflare

The **Deploy to Cloudflare** button in the [README](../README.md) makes a new copy in your Cloudflare account. The button does these steps:

- It copies this repository into your GitHub account.
- It makes the D1 database that `wrangler.jsonc` names.
- It asks for `ADMIN_TOKEN` and `PANTRY_TZ`.
- It deploys the worker with Workers Builds. Workers Builds runs `pnpm run deploy`.

The deploy script is `scripts/deploy.ts`. The script applies the D1 migrations before the new code starts. Then the script deploys the worker with the commit as `GIT_SHA`. Then the script applies the migrations again for a first deploy. You can repeat each step safely.

To examine a deploy, send `GET /v1/health`. The reply shows the `git_sha` of the deploy.

The button can read only a public repository.

## Settings

| Name | Type | Purpose |
| --- | --- | --- |
| `ADMIN_TOKEN` | secret, necessary | The owner password. It has a minimum of 16 characters. It signs in to `/console` and calls `/v1/admin`. A change to it does not change the agent tokens. |
| `PANTRY_TZ` | var | The IANA time zone for days and daily totals. The default is `UTC`. A change moves the start of the day for new entries only. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | var, optional | These enable Google sign-in through Cloudflare Access. Refer to the subsequent section. Keep them empty at the first deploy. |
| `GIT_SHA` | var | The deploy script sets this value. |

To change a setting, do these steps:

1. In the Cloudflare dashboard, open the worker.
2. Go to **Settings**, then to **Variables and Secrets**.
3. Change the value.

You can also use this command: `pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc`.

## Sign in with Google (Cloudflare Access)

The console can sign you in through [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/). Then you do not type the admin password. Access is free for a maximum of 50 users. Access can use Google, GitHub, or a one-time code by email.

`ADMIN_TOKEN` continues to operate. Agents continue to use their tokens.

**CAUTION:** Do not put Access in front of `/mcp` or `/v1/tools`. MCP clients cannot complete a browser sign-in. If Access blocks these paths, the agents stop.

1. Put Access in front of the console only. Use one of these two methods:
   - **Custom domain (recommended).** Add a custom domain to the worker. In Zero Trust, make a self-hosted Access application for `<your domain>/console`. Add a policy that permits your email address.
   - **workers.dev.** The one-click Access setting of the worker protects all of the `workers.dev` hostname. This setting also blocks the agents. If you use this setting, make a second Access application for the same hostname. Give it the paths `/mcp` and `/v1/`. Give it a **Bypass** policy for everyone. The worker continues to examine each bearer token.
2. In Zero Trust, go to **Settings**, then to **Authentication**.
3. Add a login method. One-time PIN does not have configuration steps. For Google, a Google OAuth client is necessary.
4. Copy the **Application Audience (AUD) Tag** of the console application.
5. Copy your team domain. The team domain has the format `<team>.cloudflareaccess.com`.
6. In the worker, set `ACCESS_AUD` to the AUD tag.
7. In the worker, set `ACCESS_TEAM_DOMAIN` to the team domain.
8. Open `/console`.

**NOTE:** Cloudflare can move these settings in the dashboard. If you cannot find a setting, refer to the Cloudflare Access documentation.

The worker verifies the Access JWT. It uses the keys at `https://<team>/cdn-cgi/access/certs` and the RS256 algorithm. It also examines the audience, the issuer, and the expiry time.

The worker reads the JWT from the `Cf-Access-Jwt-Assertion` header. Access adds this header only on the paths that it protects. The console also calls `/v1`, which Access does not protect. Thus, the worker also reads the `CF_Authorization` cookie on requests from the same origin.

If the two vars are empty, Access sign-in is off. If a request has a bearer token, the bearer token has priority over an Access sign-in.

## Updates

Your copy does not receive updates from this repository automatically. The workflow `.github/workflows/sync-upstream.yml` does this task:

- It moves your `main` forward to the `main` of this repository one time each day. You can also start it from the **Actions** page.
- The push to your `main` deploys the update.

The workflow fails in these conditions:

- Your `main` has its own commits.
- An update changes a workflow file.

If the workflow fails, merge `upstream/main` manually.

GitHub stops scheduled workflows in a repository that has no activity for 60 days. To start the workflow again, enable it on the **Actions** page.

## Connect an existing worker to builds

Use this procedure for a worker that you did not make with the button.

1. In the Cloudflare dashboard, open the worker.
2. Go to **Settings**, then to **Builds**.
3. Connect the GitHub repository.
4. Keep the **Build command** empty.
5. Set the **Deploy command** to `pnpm run deploy`.

**CAUTION:** Do not use a deploy command that only uploads the code. That command does not apply the migrations.

## Manual deploy

1. Install the dependencies and make the database:

   ```sh
   pnpm install
   pnpm exec wrangler d1 create hivepantry-db --config wrangler.jsonc
   ```

2. Add the new database ID to `wrangler.jsonc` as `d1_databases[0].database_id`. Do this in your working copy only. CI refuses a committed `database_id`.
3. Set the admin password and deploy:

   ```sh
   pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc
   pnpm run deploy
   ```

## Backup

To write all of the database to an SQL file, use this command:

```sh
pnpm exec wrangler d1 export hivepantry-db --remote --output backup.sql --config wrangler.jsonc
```

D1 Time Travel can also restore the database to a minute in the last 7 days. On a paid plan, the period is 30 days.
