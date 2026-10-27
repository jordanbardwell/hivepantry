// `pnpm run deploy`: what Deploy to Cloudflare and Workers Builds run on every push. It applies D1
// migrations before the new code goes live (once the database exists), deploys, and applies
// migrations again for a first deploy, where `wrangler deploy` has just created the database.
// Each step is safe to repeat.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const configPath = process.env.PANTRY_CONFIG ?? "wrangler.jsonc";

type Config = { name?: string; d1_databases?: { database_name: string }[] };

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
must(["deploy", ...(sha ? ["--var", `GIT_SHA:${sha}`] : [])]);
must(["d1", "migrations", "apply", database, "--remote"]);
