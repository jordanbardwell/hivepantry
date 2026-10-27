# Deploy

## Deploy to Cloudflare

The button in the [README](../README.md) sets up a new copy in your Cloudflare account. It copies this repository into your GitHub account, creates the D1 database named in `wrangler.jsonc`, asks for `ADMIN_TOKEN` and `PANTRY_TZ`, and deploys with Workers Builds, which runs `pnpm run deploy`.

`scripts/deploy.ts` applies D1 migrations before the new code goes live, deploys with the commit as `GIT_SHA`, and applies migrations again for a first deploy. Each step is safe to repeat. Check a deploy with `GET /v1/health`, which reports `git_sha`.

The button can read only a public repository.

## Settings

| Name | Kind | Purpose |
| --- | --- | --- |
| `ADMIN_TOKEN` | secret, required | The owner password, at least 16 characters. Signs in to `/console` and calls `/v1/admin`. Changing it does not affect agent tokens. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | var, optional | Turn on Google sign-in through Cloudflare Access; see below. Leave empty at deploy. |
| `PANTRY_TZ` | var | IANA time zone for days and daily totals. Default `UTC`. Changing it later moves the day boundary for new entries only. |
| `GIT_SHA` | var | Set by the deploy script. |

Change a setting in the Cloudflare dashboard: open the worker, then **Settings**, then **Variables and Secrets**. Or run `pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc`.

## Sign in with Google (Cloudflare Access)

The console can sign you in through [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) instead of the admin password. Access is free for up to 50 users and offers Google, GitHub, or a one-time code by email. `ADMIN_TOKEN` keeps working, and agents keep their tokens: MCP clients cannot complete a browser login, so Access must not stand in front of `/mcp` or `/v1/tools`.

1. Put Access in front of the console only:
   - **Custom domain (cleanest).** Add a custom domain to the worker. In Zero Trust, create a self-hosted Access application for `<your domain>/console` with a policy that allows your email.
   - **workers.dev.** The worker's one-click Access setting protects the whole `workers.dev` hostname, which also blocks agents. If you use it, add a second Access application for the same hostname with the paths `/mcp` and `/v1/` and a **Bypass** policy for everyone; the worker still checks every bearer token.
2. Add a login method under Zero Trust **Settings > Authentication**. One-time PIN needs no setup; Google needs a Google OAuth client.
3. Copy the application's **Application Audience (AUD) Tag** and your team domain (`<team>.cloudflareaccess.com`).
4. Set the worker vars `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` (worker **Settings > Variables and Secrets**, or the `vars` in your copy of `wrangler.jsonc`), then open `/console`.

The worker verifies the Access JWT itself: RS256 against `https://<team>/cdn-cgi/access/certs`, with the configured audience and issuer, and checks expiry. It reads the `Cf-Access-Jwt-Assertion` header, or the `CF_Authorization` cookie on same-origin requests, because Access adds the header only on the paths it protects and the console calls `/v1`. Both vars empty turns Access sign-in off. A bearer token on a request always wins over an Access sign-in.

## Updates

Your copy does not follow this repository on its own. `.github/workflows/sync-upstream.yml` fast-forwards your `main` to this repository's `main` once a day (or from the Actions tab), and that push deploys the update. If your `main` has its own commits, or an update changes a workflow file, the run fails and you merge `upstream/main` by hand. GitHub pauses scheduled workflows in a repository with no activity for 60 days; re-enable it from the Actions tab.

## Connect an existing worker to builds

1. In the Cloudflare dashboard, open the worker. Go to **Settings**, then **Builds**.
2. Connect the GitHub repository.
3. Keep the **Build command** empty.
4. Set the **Deploy command** to `pnpm run deploy`.

Do not use a deploy command that only uploads the code; it would skip the migrations.

## Deploy by hand

```sh
pnpm install
pnpm exec wrangler d1 create hivepantry-db --config wrangler.jsonc
```

Add the new id to `wrangler.jsonc` as `d1_databases[0].database_id` in your working copy only; CI refuses a committed `database_id`. Then:

```sh
pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc
pnpm run deploy
```

## Back up

`pnpm exec wrangler d1 export hivepantry-db --remote --output backup.sql --config wrangler.jsonc` writes the whole database as SQL. D1 Time Travel also restores the database to any minute in the last 7 days (30 on a paid plan).
