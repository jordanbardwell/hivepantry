import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN, call, mint, reset, rest, rpc } from "./helpers";

beforeEach(reset);

describe("auth", () => {
  it("answers health without a token", async () => {
    const health = await rest("/v1/health", null);
    expect(health.status).toBe(200);
    expect(health.json.data).toMatchObject({ status: "ok", service: "HivePantry", git_sha: "abc123" });
  });

  it("refuses /v1 and /mcp without a valid token", async () => {
    expect((await call("nope", "whoami")).status).toBe(401);
    const missing = await rest("/v1/tools/whoami", null, { method: "POST", body: "{}" });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    expect((await rpc(null, "tools/list")).status).toBe(401);
    expect((await rpc("hp_x_bad", "tools/list")).status).toBe(401);
  });

  it("treats ADMIN_TOKEN as the admin on the console API and /v1/admin only", async () => {
    const me = await rest("/console/api/tools/whoami", ADMIN, { method: "POST", body: "{}" });
    expect(me.json.data).toMatchObject({ agent_id: "owner", admin: true, time_zone: "America/New_York" });
    expect((await rest("/v1/admin/agents", ADMIN)).status).toBe(200);
    expect((await call(ADMIN, "whoami")).status).toBe(403);
    expect((await rpc(ADMIN, "tools/list")).status).toBe(403);
  });

  it("limits ADMIN_TOKEN tries per IP but not agent tokens", async () => {
    const agent = await mint("claude");
    const headers = { "cf-connecting-ip": "192.0.2.7" };
    const statuses: number[] = [];
    for (let i = 0; i < 121; i++) statuses.push((await rest("/v1/admin/agents", `wrong-guess-${i}`, { headers })).status);
    expect(statuses.slice(0, 120).every((s) => s === 401)).toBe(true);
    expect(statuses[120]).toBe(429);
    expect((await rest("/v1/admin/agents", ADMIN, { headers })).status).toBe(429);
    expect((await rest("/v1/tools/whoami", agent, { method: "POST", body: "{}", headers })).status).toBe(200);
  });

  it("stops a token after its expiry", async () => {
    const minted = await rest("/v1/admin/tokens", ADMIN, { method: "POST", body: JSON.stringify({ agent_id: "temp", expires_in_days: 30 }) });
    expect(minted.json.data.expires_at).toMatch(/^\d{4}-/);
    const token = minted.json.data.token as string;
    expect((await call(token, "whoami")).status).toBe(200);
    await (env as Env).DB.prepare("UPDATE tokens SET expires_at = ? WHERE id = ?").bind("2000-01-01T00:00:00.000Z", minted.json.data.token_id).run();
    expect((await call(token, "whoami")).status).toBe(401);
  });

  it("mints, scopes, and revokes agent tokens", async () => {
    const writer = await mint("claude");
    const reader = await mint("viewer", ["read"]);
    expect(writer).toMatch(/^hp_claude_/);
    expect((await call(writer, "whoami")).json.data).toMatchObject({ agent_id: "claude", admin: false, scopes: ["read", "write"] });

    const food = { name: "Apple", calories: 95, protein_g: 0.5, carbs_g: 25, fat_g: 0.3 };
    expect((await call(reader, "log_food", food)).status).toBe(403);
    expect((await call(reader, "get_day")).status).toBe(200);
    expect((await rest("/v1/admin/agents", writer)).status).toBe(403);

    const listed = await rest("/v1/admin/agents", ADMIN);
    const tokenId = listed.json.data.agents.find((a: any) => a.id === "claude").tokens[0].id;
    expect((await rest(`/v1/admin/tokens/${tokenId}`, ADMIN, { method: "DELETE" })).status).toBe(200);
    expect((await call(writer, "whoami")).status).toBe(401);
  });

  it("shows a token again and changes its access", async () => {
    const minted = await rest("/v1/admin/tokens", ADMIN, { method: "POST", body: JSON.stringify({ agent_id: "claude-code", name: "Claude Code" }) });
    const { token, token_id } = minted.json.data;
    const shown = await rest(`/console/api/admin/tokens/${token_id}`, ADMIN);
    expect(shown.json.data).toMatchObject({ token, agent_id: "claude-code", name: "Claude Code", scopes: ["read", "write"] });
    expect((await rest("/v1/admin/agents", ADMIN)).json.data.agents[0].tokens[0].viewable).toBe(true);
    expect((await rest(`/v1/admin/tokens/${token_id}`, token)).status).toBe(403);

    const food = { name: "Apple", calories: 95, protein_g: 0.5, carbs_g: 25, fat_g: 0.3 };
    const put = (scopes: unknown) => rest(`/console/api/admin/tokens/${token_id}`, ADMIN, { method: "PUT", body: JSON.stringify({ scopes }) });
    expect((await put(["read"])).json.data).toEqual({ token_id, scopes: ["read"] });
    expect((await call(token, "log_food", food)).status).toBe(403);
    expect((await put(["read", "write"])).status).toBe(200);
    expect((await call(token, "log_food", food)).status).toBe(200);
    expect((await put([])).status).toBe(400);

    await rest(`/v1/admin/tokens/${token_id}`, ADMIN, { method: "DELETE" });
    expect((await rest(`/console/api/admin/tokens/${token_id}`, ADMIN)).status).toBe(404);
    const stored = await (env as Env).DB.prepare("SELECT token_value FROM tokens WHERE id = ?").bind(token_id).first<{ token_value: string | null }>();
    expect(stored?.token_value).toBeNull();
    expect((await put(["read"])).status).toBe(404);
  });

  it("disables an agent and all its tokens", async () => {
    const token = await mint("bot");
    expect((await rest("/v1/admin/agents/bot", ADMIN, { method: "DELETE" })).status).toBe(200);
    expect((await call(token, "whoami")).status).toBe(401);
    // Minting again enables the agent with a fresh token.
    const fresh = await mint("bot");
    expect((await call(fresh, "whoami")).status).toBe(200);
  });

  it("rejects bad agent ids", async () => {
    for (const agent_id of ["owner", "Has Space", ""]) {
      const result = await rest("/v1/admin/tokens", ADMIN, { method: "POST", body: JSON.stringify({ agent_id }) });
      expect(result.status).toBe(400);
    }
  });
});

describe("console", () => {
  it("redirects / to the console and serves it with a nonce CSP", async () => {
    const root = await rest("/", null, { redirect: "manual" });
    expect(root.status).toBe(302);
    const page = await rest("/console", null);
    expect(page.status).toBe(200);
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
  });
});
