import type { z } from "zod";
import { parseScopes, type Scope } from "./auth";
import { randomToken, sha256Hex, ulid } from "./crypto";
import { PantryError } from "./errors";
import type { mintSchema, scopesSchema } from "./schemas";

type AgentRow = { id: string; name: string; created_at: string; disabled_at: string | null };
type TokenRow = {
  id: string;
  agent_id: string;
  scopes: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  viewable: number;
};

export async function listAgents(env: Env) {
  const [agents, tokens] = await Promise.all([
    env.DB.prepare("SELECT * FROM agents ORDER BY created_at").all<AgentRow>(),
    env.DB.prepare("SELECT id, agent_id, scopes, label, created_at, last_used_at, revoked_at, expires_at, token_value IS NOT NULL AS viewable FROM tokens ORDER BY created_at").all<TokenRow>(),
  ]);
  return {
    agents: agents.results.map((agent) => ({
      ...agent,
      tokens: tokens.results.filter((t) => t.agent_id === agent.id).map((t) => ({ ...t, scopes: parseScopes(t.scopes), viewable: Boolean(t.viewable) })),
    })),
  };
}

// Makes the agent if it is new, enables it if it was disabled, and mints a token. The database keeps
// its hash for sign-in and its value, so that the owner can see the token again in the console.
export async function mintToken(env: Env, input: z.infer<typeof mintSchema>) {
  const issued = new Date();
  const now = issued.toISOString();
  const expiresAt = input.expires_in_days ? new Date(issued.getTime() + input.expires_in_days * 86_400_000).toISOString() : null;
  const scopes: Scope[] = [...new Set(input.scopes ?? (["read", "write"] as Scope[]))];
  const token = randomToken(input.agent_id);
  const tokenId = ulid();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO agents (id, name, created_at) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET disabled_at = NULL, name = COALESCE(?, agents.name)`,
    ).bind(input.agent_id, input.name ?? input.agent_id, now, input.name ?? null),
    env.DB.prepare("INSERT INTO tokens (id, agent_id, token_hash, token_value, scopes, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
      tokenId,
      input.agent_id,
      await sha256Hex(token),
      token,
      scopes.join(","),
      input.label ?? null,
      now,
      expiresAt,
    ),
  ]);
  return { agent_id: input.agent_id, token_id: tokenId, scopes, expires_at: expiresAt, token };
}

// The token value, for the owner only. A token made before migration 0005 has no stored value.
export async function showToken(env: Env, tokenId: string) {
  const row = await env.DB.prepare(
    `SELECT t.id, t.agent_id, a.name, t.scopes, t.token_value, t.expires_at FROM tokens t JOIN agents a ON a.id = t.agent_id
     WHERE t.id = ? AND t.revoked_at IS NULL AND a.disabled_at IS NULL`,
  )
    .bind(tokenId)
    .first<{ id: string; agent_id: string; name: string; scopes: string; token_value: string | null; expires_at: string | null }>();
  if (!row) throw new PantryError("not_found", `No active token with id ${tokenId}`);
  return { token_id: row.id, agent_id: row.agent_id, name: row.name, scopes: parseScopes(row.scopes), expires_at: row.expires_at, token: row.token_value };
}

export async function setTokenScopes(env: Env, tokenId: string, input: z.infer<typeof scopesSchema>) {
  const scopes: Scope[] = [...new Set(input.scopes)];
  const result = await env.DB.prepare("UPDATE tokens SET scopes = ? WHERE id = ? AND revoked_at IS NULL").bind(scopes.join(","), tokenId).run();
  if (!result.meta.changes) throw new PantryError("not_found", `No active token with id ${tokenId}`);
  return { token_id: tokenId, scopes };
}

export async function revokeToken(env: Env, tokenId: string) {
  const result = await env.DB.prepare("UPDATE tokens SET revoked_at = ?, token_value = NULL WHERE id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), tokenId).run();
  if (!result.meta.changes) throw new PantryError("not_found", `No active token with id ${tokenId}`);
  return { token_id: tokenId, revoked: true };
}

export async function disableAgent(env: Env, agentId: string) {
  const now = new Date().toISOString();
  const [agent] = await env.DB.batch([
    env.DB.prepare("UPDATE agents SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL").bind(now, agentId),
    env.DB.prepare("UPDATE tokens SET revoked_at = ?, token_value = NULL WHERE agent_id = ? AND revoked_at IS NULL").bind(now, agentId),
  ]);
  if (!agent?.meta.changes) throw new PantryError("not_found", `No active agent with id ${agentId}`);
  return { agent_id: agentId, disabled: true };
}
