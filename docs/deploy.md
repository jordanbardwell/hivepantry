# Deploy

## Deploy to Cloudflare

The button in the [README](../README.md) sets up a new copy in your Cloudflare account. It copies this repository into your GitHub account, creates the D1 database named in `wrangler.jsonc`, asks for `ADMIN_TOKEN` and `PANTRY_TZ`, and deploys with Workers Builds, which runs `pnpm run deploy`.

`scripts/deploy.ts` applies D1 migrations before the new code goes live, deploys with the commit as `GIT_SHA`, and applies migrations again for a first deploy. Each step is safe to repeat. Check a deploy with `GET /v1/health`, which reports `git_sha`.

The button can read only a public repository.

## Settings

| Name | Kind | Purpose |
| --- | --- | --- |
| `ADMIN_TOKEN` | secret, required | The owner password, at least 16 characters. Signs in to `/console` and calls `/v1/admin`. Changing it does not affect agent tokens. |
| `PANTRY_TZ` | var | IANA time zone for days and daily totals. Default `UTC`. Changing it later moves the day boundary for new entries only. |
| `GIT_SHA` | var | Set by the deploy script. |

Change a setting in the Cloudflare dashboard: open the worker, then **Settings**, then **Variables and Secrets**. Or run `pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc`.

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
