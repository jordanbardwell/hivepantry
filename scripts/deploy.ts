// `pnpm run deploy`: what Deploy to Cloudflare and Workers Builds run on every push. It applies D1
// migrations before the new code goes live (once the database exists), puts Cloudflare Access in
// front of the console when OWNER_EMAIL is set, deploys, and applies migrations again for a first
// deploy, where `wrangler deploy` has just created the database. Each step is safe to repeat.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cloudflareApi, ensureConsoleAccess, ownerEmails } from "./access-setup.ts";

const configPath = process.env.PANTRY_CONFIG ?? "wrangler.jsonc";

type Config = { name?: string; vars?: Record<string, string>; d1_databases?: { database_name: string }[] };

const config = JSON.parse(
  readFileSync(configPath, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n"),
) as Config;

function wrangler(args: string[], quiet = false): boolean {
  const run = spawnSync("pnpm", ["exec", "wrangler", ...args, "--config", configPath], { stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
  return run.status === 0;
}

function must(args: string[]): void {
  if (!wrangler(args)) {
    console.error(`wrangler ${args.join(" ")} failed`);
    process.exit(1);
  }
}

const database = config.d1_databases?.[0]?.database_name;
if (!database) {
  console.error(`${configPath} names no D1 database`);
  process.exit(1);
}
if (wrangler(["d1", "info", database], true)) must(["d1", "migrations", "apply", database, "--remote"]);

let sha = process.env.WORKERS_CI_COMMIT_SHA ?? "";
if (!sha) {
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    sha = "";
  }
}
// Access is an addition to ADMIN_TOKEN, so a failure here warns and the deploy goes on.
const vars: string[] = sha ? ["--var", `GIT_SHA:${sha}`] : [];
const emails = ownerEmails(process.env.OWNER_EMAIL ?? config.vars?.OWNER_EMAIL);
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (emails.length && !apiToken) {
  console.warn("OWNER_EMAIL is set, but CLOUDFLARE_API_TOKEN is not. Skipping Cloudflare Access for the console.");
} else if (emails.length && apiToken) {
  try {
    const cf = cloudflareApi(apiToken);
    let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
      const accounts = (await cf("/accounts")) as { id: string }[];
      if (accounts.length !== 1) throw new Error("Set CLOUDFLARE_ACCOUNT_ID: the token can see more than one account");
      accountId = accounts[0]!.id;
    }
    const access = await ensureConsoleAccess(cf, { accountId, workerName: config.name ?? "hivepantry", appName: "HivePantry", emails });
    vars.push("--var", `ACCESS_TEAM_DOMAIN:${access.team}`, "--var", `ACCESS_AUD:${access.aud}`);
    console.log(`Cloudflare Access protects https://${access.host}/console for ${emails.join(", ")}.`);
  } catch (err) {
    console.warn(
      `Could not set up Cloudflare Access for the console, so it keeps the ADMIN_TOKEN sign-in only. ${err instanceof Error ? err.message : String(err)}\n` +
        "The build token needs the permissions Access: Apps and Policies (Edit) and Access: Organizations, Identity Providers, and Groups (Edit).",
    );
  }
}
must(["deploy", ...vars]);
must(["d1", "migrations", "apply", database, "--remote"]);
