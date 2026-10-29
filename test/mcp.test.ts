import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { mint, reset, rpc } from "./helpers";
import { TOOLS } from "../src/tools";

let agent: string;
beforeEach(async () => {
  await reset();
  agent = await mint("claude");
});

describe("mcp", () => {
  it("lists every tool with an input schema", async () => {
    const { status, body } = await rpc(agent, "tools/list");
    expect(status).toBe(200);
    const names = body.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(TOOLS.map((t) => t.name).sort());
    const logFood = body.result.tools.find((t: any) => t.name === "log_food");
    expect(logFood.inputSchema.properties).toHaveProperty("food_id");
  });

  it("calls a tool and returns the REST envelope as text", async () => {
    const { body } = await rpc(agent, "tools/call", {
      name: "log_food",
      arguments: { name: "Apple", calories: 95, protein_g: 0.5, carbs_g: 25, fat_g: 0.3, date: "2026-10-20" },
    });
    const parsed = JSON.parse(body.result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.day.totals.calories).toBe(95);
  });

  it("reports a tool error with isError", async () => {
    const { body } = await rpc(agent, "tools/call", { name: "delete_entry", arguments: { id: "missing" } });
    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0].text).error.code).toBe("not_found");
  });

  it("refuses a body larger than 64 KB, as REST does", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: { pad: "x".repeat(70_000) } } });
    const response = await SELF.fetch("https://pantry.test/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${agent}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body,
    });
    expect(response.status).toBe(400);
  });
});
