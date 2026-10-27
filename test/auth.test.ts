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

  it("treats ADMIN_TOKEN as the admin", async () => {
    const me = await call(ADMIN, "whoami");
    expect(me.json.data).toMatchObject({ agent_id: "owner", admin: true, time_zone: "America/New_York" });
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
