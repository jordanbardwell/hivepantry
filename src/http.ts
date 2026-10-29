import { disableAgent, listAgents, mintToken, revokeToken } from "./admin";
import { authenticate, bearerOf, requireAdmin } from "./auth";
import { APP_NAME, VERSION } from "./brand";
import { CONSOLE_PATH, consoleResponse } from "./console";
import { errorBody, PantryError, toPantryError } from "./errors";
import { mcpHandler } from "./mcp";
import { mintSchema } from "./schemas";
import { callTool, TOOLS, TOOLS_BY_NAME } from "./tools";

const MAX_BODY_BYTES = 64 * 1024;
const CONSOLE_API = `${CONSOLE_PATH}/api/`;

function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function ok(data: unknown, status = 200): Response {
  return json(status, { ok: true, data });
}

function fail(err: unknown): Response {
  const error = toPantryError(err);
  const headers: Record<string, string> = error.code === "unauthorized" ? { "www-authenticate": 'Bearer realm="mcp"' } : {};
  return json(error.status, { ok: false, error: errorBody(error) }, headers);
}

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new PantryError("invalid", `Body is larger than ${MAX_BODY_BYTES} bytes`);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new PantryError("invalid", `Body is larger than ${MAX_BODY_BYTES} bytes`);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new PantryError("invalid", "Body is not JSON");
  }
}

export async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  try {
    const page = consoleResponse(request, url);
    if (page) return page;

    if (url.pathname === "/v1/health" && request.method === "GET") {
      return ok({ status: "ok", service: APP_NAME, version: VERSION, git_sha: env.GIT_SHA || null });
    }

    if (url.pathname === "/mcp") {
      if (!bearerOf(request)) throw new PantryError("unauthorized", "Bearer token required");
      const access = await authenticate(request, env, ctx);
      return await mcpHandler(request, env, ctx, access);
    }

    // The console calls the API under its own path, so the Cloudflare Access application on
    // /console also signs in its API calls. /mcp and /v1 stay outside Access for agents.
    const consoleApi = url.pathname.startsWith(CONSOLE_API);
    const apiPath = consoleApi ? `/v1/${url.pathname.slice(CONSOLE_API.length)}` : url.pathname;
    if (!apiPath.startsWith("/v1/")) throw new PantryError("not_found", "Not found");
    const access = await authenticate(request, env, ctx, consoleApi);
    // Access signs the browser in with a cookie, so a page on another site could send a simple
    // cross-site POST with it. Browsers send Origin on every POST and DELETE; only our own counts.
    if (access.via === "access" && request.method !== "GET" && request.method !== "HEAD" && request.headers.get("origin") !== url.origin) {
      throw new PantryError("forbidden", "A console change must come from the console page");
    }
    const path = apiPath.slice("/v1/".length).split("/");

    if (path[0] === "tools") {
      if (path.length === 1 && request.method === "GET") {
        return ok({ tools: TOOLS.map((t) => ({ name: t.name, scope: t.scope, description: t.description })) });
      }
      const tool = path.length === 2 ? TOOLS_BY_NAME.get(path[1]!) : undefined;
      if (!tool) throw new PantryError("not_found", "No such tool");
      if (request.method !== "POST") throw new PantryError("invalid", "Call a tool with POST");
      return ok(await callTool(env, access, tool, await readJson(request)));
    }

    if (path[0] === "admin") {
      requireAdmin(access);
      const route = `${request.method} ${path.slice(1, 2).join("/")}`;
      if (route === "GET agents" && path.length === 2) return ok(await listAgents(env));
      if (route === "POST tokens" && path.length === 2) {
        const minted = await mintToken(env, mintSchema.parse(await readJson(request)));
        return ok({ ...minted, mcp_url: new URL("/mcp", url).toString() }, 201);
      }
      if (route === "DELETE tokens" && path.length === 3) return ok(await revokeToken(env, decodeURIComponent(path[2]!)));
      if (route === "DELETE agents" && path.length === 3) return ok(await disableAgent(env, decodeURIComponent(path[2]!)));
    }

    throw new PantryError("not_found", "Not found");
  } catch (err) {
    return fail(err);
  }
}
