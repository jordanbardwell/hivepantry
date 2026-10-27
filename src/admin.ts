import type { z } from "zod";
import { parseScopes, type Scope } from "./auth";
import { randomToken, sha256Hex, ulid } from "./crypto";
import { PantryError } from "./errors";
import type { mintSchema } from "./schemas";

type AgentRow = { id: string; name: string; created_at: string; disabled_at: string | null };
type TokenRow = { id: string; agent_id: string; scopes: string; label: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null };

export async function listAgents(env: Env) {
  const [agents, tokens] = await Promise.all([
    env.DB.prepare("SELECT * FROM agents ORDER BY created_at").all<AgentRow>(),
    env.DB.prepare("SELECT id, agent_id, scopes, label, created_at, last_used_at, revoked_at FROM tokens ORDER BY created_at").all<TokenRow>(),
  ]);
  return {
    agents: agents.results.map((agent) => ({
      ...agent,
      tokens: tokens.results.filter((t) => t.agent_id === agent.id).map((t) => ({ ...t, scopes: parseScopes(t.scopes) })),
    })),
  };
}

// Makes the agent if it is new, enables it if it was disabled, and mints a token. The token is in
// this reply only; the database keeps its hash.
export async function mintToken(env: Env, input: z.infer<typeof mintSchema>) {
  const now = new Date().toISOString();
  const scopes: Scope[] = [...new Set(input.scopes ?? (["read", "write"] as Scope[]))];
  const token = randomToken(input.agent_id);
  const tokenId = ulid();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO agents (id, name, created_at) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET disabled_at = NULL, name = COALESCE(?, agents.name)`,
    ).bind(input.agent_id, input.name ?? input.agent_id, now, input.name ?? null),
    env.DB.prepare("INSERT INTO tokens (id, agent_id, token_hash, scopes, label, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      tokenId,
      input.agent_id,
      await sha256Hex(token),
      scopes.join(","),
      input.label ?? null,
      now,
    ),
  ]);
  return { agent_id: input.agent_id, token_id: tokenId, scopes, token };
}

export async function revokeToken(env: Env, tokenId: string) {
  const result = await env.DB.prepare("UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), tokenId).run();
  if (!result.meta.changes) throw new PantryError("not_found", `No active token with id ${tokenId}`);
  return { token_id: tokenId, revoked: true };
}

export async function disableAgent(env: Env, agentId: string) {
  const now = new Date().toISOString();
  const [agent] = await env.DB.batch([
    env.DB.prepare("UPDATE agents SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL").bind(now, agentId),
    env.DB.prepare("UPDATE tokens SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL").bind(now, agentId),
  ]);
  if (!agent?.meta.changes) throw new PantryError("not_found", `No active agent with id ${agentId}`);
  return { agent_id: agentId, disabled: true };
}
