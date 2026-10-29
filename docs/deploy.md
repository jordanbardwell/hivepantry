# Deploy

This document tells you how to deploy, update, and configure a copy of HivePantry.

## Deploy to Cloudflare

The **Deploy to Cloudflare** button in the [README](../README.md) makes a new copy in your Cloudflare account. The button does these steps:

- It copies this repository into your GitHub account.
- It makes the D1 database that `wrangler.jsonc` names.
- It asks for `ADMIN_TOKEN` only.
- It deploys the worker with Workers Builds. Workers Builds runs `pnpm run deploy`.

The deploy script is `scripts/deploy.ts`. The script applies the D1 migrations before the new code starts. Then the script deploys the worker with the commit as `GIT_SHA`. Then the script applies the migrations again for a first deploy. Then the script turns on the `workers.dev` address of the worker with the Cloudflare API. If it cannot turn on the address, the build fails. You can repeat each step safely.

To examine a deploy, send `GET /v1/health`. The reply shows the `git_sha` of the deploy.

The button can read only a public repository.

## Settings

| Name | Type | Purpose |
| --- | --- | --- |
| `ADMIN_TOKEN` | secret, necessary | The owner password. It has a minimum of 8 characters. It signs in to `/console` and calls `/v1/admin`. A change to it does not change the agent tokens. The deploy form asks only for this setting. |
| `PANTRY_TZ` | var | The IANA time zone for days and daily totals before the first console sign-in. The default is `UTC`. At the first sign-in, the console stores the time zone of your browser. The stored time zone has priority over `PANTRY_TZ`. |
| `OWNER_EMAIL` | build variable, optional | Your email address. Use commas between more than one address. If you set it, the deploy puts Cloudflare Access in front of the console. Refer to the subsequent section. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | var | The deploy sets these values. Do not change them. |
| `GIT_SHA` | var | The deploy script sets this value. |

To change a setting, do these steps:

1. In the Cloudflare dashboard, open the worker.
2. Go to **Settings**, then to **Variables and Secrets**.
3. Change the value.

You can also use this command: `pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc`.

## Console sign-in with Cloudflare Access

If you set `OWNER_EMAIL`, the deploy puts [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/) in front of the console. Then you do not type the admin password. Access is free for a maximum of 50 users.

The deploy form does not ask for `OWNER_EMAIL`. To set it, do these steps:

1. In the Cloudflare dashboard, open the worker.
2. Go to **Settings**, then to **Builds**, then to **Variables and secrets**.
3. Add the build variable `OWNER_EMAIL` with your email address.
4. Start the deploy again.

The deploy script (`scripts/access-setup.ts`) does these steps on each deploy:

- It makes the Zero Trust organization if it does not exist. The team domain is `<workers.dev subdomain>.cloudflareaccess.com`.
- It adds the One-time PIN login method if the account does not have a login method.
- It makes a self-hosted Access application for `<worker>.<subdomain>.workers.dev/console` if it does not exist. It sets the session cookie of the application to `SameSite=Lax` and `HttpOnly`.
- It sets the "Owner" policy of the application to the addresses in `OWNER_EMAIL`.
- It sets `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `OWNER_EMAIL` on the worker.

The Access application covers only `/console`. The console calls its API at `/console/api/`. Access does not cover `/mcp` and `/v1`. Thus, agents continue to use their bearer tokens.

With One-time PIN, Cloudflare sends a code to your email address. To sign in with Google, add Google as a login method in Zero Trust. The application accepts all login methods of the account.

The worker verifies the Access JWT in the `Cf-Access-Jwt-Assertion` header. It uses the keys at `https://<team>/cdn-cgi/access/certs` and the RS256 algorithm. It examines the audience, the issuer, and the expiry time. It also examines that the email is in `OWNER_EMAIL`. `ADMIN_TOKEN` continues to operate.

The worker accepts the Access JWT only on `/console/api/`. On `/v1` and `/mcp`, it accepts only bearer tokens. For a change with an Access sign-in (each method other than `GET`), the `Origin` header must be the address of the worker. Thus, a page on a different site cannot use your Access sign-in to change your data.

**CAUTION:** The deploy uses the API token of Workers Builds. This token must have these permissions:

- Access: Apps and Policies (Edit)
- Access: Organizations, Identity Providers, and Groups (Edit)

The second permission can change all of your Zero Trust organization. The deploy needs Edit only for the first deploy, when it makes the organization and the login method. After the first deploy, change this permission to Read.

If the token does not have these permissions, the deploy shows a warning and continues. If an earlier deploy set up Access, the worker keeps its Access settings. If not, the console uses only `ADMIN_TOKEN`. To add the permissions, edit the build token in the Cloudflare dashboard. Then start the deploy again.

**CAUTION:** Do not enable the one-click Access setting on the worker. That setting covers all of the `workers.dev` hostname, also `/mcp`. MCP clients cannot complete a browser sign-in, so the agents stop.

## Updates

Your copy does not receive updates from this repository automatically. An update runs code from this repository with your data. Thus, you must decide to accept updates.

Deploy to Cloudflare makes your copy with one new commit. That commit does not have the history of this repository or the `.github` folder. It also writes the worker name and the `database_id` into `wrangler.jsonc`. Thus, to receive updates, you must first connect your copy to this repository one time. Do these steps on your computer. Replace `<you>/<copy>` with the name of your copy:

```sh
git clone https://github.com/<you>/<copy>.git && cd <copy>
git remote add upstream https://github.com/jordanbardwell/hivepantry.git
git fetch upstream
cp wrangler.jsonc /tmp/copy-wrangler.jsonc
git reset --hard upstream/main
```

Then, in `wrangler.jsonc`, set `name` and `d1_databases[0].database_id` to the values in `/tmp/copy-wrangler.jsonc`. Do not change other lines. Then push:

```sh
git commit -am "Keep the worker name and database of this copy"
git push --force origin main
```

**CAUTION:** If the name or the `database_id` is incorrect, the deploy makes a new worker or a new empty database. Your data stays in the old database.

Then do these steps:

1. In your GitHub copy, go to **Settings**, then to **Secrets and variables**, then to **Actions**.
2. On the **Variables** tab, add the repository variable `SYNC_UPSTREAM` with the value `true`.

Then the workflow `.github/workflows/sync-upstream.yml` does this task:

- It merges the `main` of this repository into your `main` one time each day. You can also start it from the **Actions** page. Your own commits stay.
- The push to your `main` deploys the update.

The workflow fails in these conditions:

- The merge has a conflict. Then the workflow does not change your `main`.
- An update changes a workflow file.

If the workflow fails, merge `upstream/main` manually.

To stop updates, delete the variable or set it to `false`.

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
