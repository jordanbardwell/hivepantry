import { env, SELF } from "cloudflare:test";

export const ADMIN = "test-admin-token-not-a-secret";
const BASE = "https://pantry.test";

export type Envelope = { ok: boolean; data?: any; error?: { code: string; message: string; issues?: string[] } };

export async function rest(path: string, token: string | null, init: RequestInit = {}): Promise<{ status: number; json: Envelope; headers: Headers }> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await SELF.fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let json: Envelope;
  try {
    json = JSON.parse(text) as Envelope;
  } catch {
    json = { ok: false, error: { code: "non_json", message: text.slice(0, 200) } };
  }
  return { status: response.status, json, headers: response.headers };
}

export async function call(token: string, tool: string, args: Record<string, unknown> = {}): Promise<{ status: number; json: Envelope }> {
  return rest(`/v1/tools/${tool}`, token, { method: "POST", body: JSON.stringify(args) });
}

export async function data(token: string, tool: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await call(token, tool, args);
  if (!result.json.ok) throw new Error(`${tool} failed: ${result.status} ${JSON.stringify(result.json.error)}`);
  return result.json.data;
}

export async function mint(agentId: string, scopes: string[] = ["read", "write"]): Promise<string> {
  const result = await rest("/v1/admin/tokens", ADMIN, { method: "POST", body: JSON.stringify({ agent_id: agentId, scopes }) });
  if (result.status !== 201) throw new Error(`mint failed: ${result.status} ${JSON.stringify(result.json)}`);
  return result.json.data.token as string;
}

function parseRpc(text: string): any {
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text);
}

// Runs initialize, then one JSON-RPC request, over the streamable HTTP transport.
export async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const init = await SELF.fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } }),
  });
  const initText = await init.text();
  if (init.status !== 200) return { status: init.status, body: initText ? JSON.parse(initText) : null };
  const session = init.headers.get("mcp-session-id");
  if (session) headers["mcp-session-id"] = session;
  await SELF.fetch(`${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const response = await SELF.fetch(`${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }) });
  return { status: response.status, body: parseRpc(await response.text()) };
}

export async function reset(): Promise<void> {
  const db = (env as Env).DB;
  await db.batch(["entries", "foods", "goals", "weights", "tokens", "agents"].map((t) => db.prepare(`DELETE FROM ${t}`)));
}
