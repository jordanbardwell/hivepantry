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
| `OWNER_EMAIL` | var, optional | Your email address. Use commas between more than one address. If you set it, the deploy puts Cloudflare Access in front of the console. Refer to the subsequent section. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | var | The deploy sets these values. Do not change them. |
| `GIT_SHA` | var | The deploy script sets this value. |

To change a setting, do these steps:

1. In the Cloudflare dashboard, open the worker.
2. Go to **Settings**, then to **Variables and Secrets**.
3. Change the value.

You can also use this command: `pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc`.

## Console sign-in with Cloudflare Access

If you set `OWNER_EMAIL`, the deploy puts [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/) in front of the console. Then you do not type the admin password. Access is free for a maximum of 50 users.

The deploy script (`scripts/access-setup.ts`) does these steps on each deploy:

- It makes the Zero Trust organization if it does not exist. The team domain is `<workers.dev subdomain>.cloudflareaccess.com`.
- It adds the One-time PIN login method if the account does not have a login method.
- It makes a self-hosted Access application for `<worker>.<subdomain>.workers.dev/console` if it does not exist.
- It sets the "Owner" policy of the application to the addresses in `OWNER_EMAIL`.
- It sets `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` on the worker.

The Access application covers only `/console`. The console calls its API at `/console/api/`. Access does not cover `/mcp` and `/v1`. Thus, agents continue to use their bearer tokens.

With One-time PIN, Cloudflare sends a code to your email address. To sign in with Google, add Google as a login method in Zero Trust. The application accepts all login methods of the account.

The worker verifies the Access JWT in the `Cf-Access-Jwt-Assertion` header. It uses the keys at `https://<team>/cdn-cgi/access/certs` and the RS256 algorithm. It examines the audience, the issuer, and the expiry time. It also examines that the email is in `OWNER_EMAIL`. `ADMIN_TOKEN` continues to operate.

**CAUTION:** The deploy uses the API token of Workers Builds. This token must have these permissions:

- Access: Apps and Policies (Edit)
- Access: Organizations, Identity Providers, and Groups (Edit)

If the token does not have these permissions, the deploy shows a warning and continues without Access. The console then uses only `ADMIN_TOKEN`. To add the permissions, edit the build token in the Cloudflare dashboard. Then start the deploy again.

**CAUTION:** Do not enable the one-click Access setting on the worker. That setting covers all of the `workers.dev` hostname, also `/mcp`. MCP clients cannot complete a browser sign-in, so the agents stop.

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
