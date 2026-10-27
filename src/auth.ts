import { accessConfig, accessJwtOf, verifyAccessJwt } from "./access";
import { sha256Hex, timingSafeEqual } from "./crypto";
import { PantryError } from "./errors";

export type Scope = "read" | "write";

export type Access = {
  agentId: string;
  tokenId: string;
  scopes: Scope[];
  admin: boolean;
  via: "admin_token" | "access" | "agent_token";
  email?: string;
};

export const ADMIN_AGENT_ID = "owner";
export const MIN_ADMIN_TOKEN_LENGTH = 16;

type TokenRow = { token_id: string; agent_id: string; scopes: string; revoked_at: string | null; disabled_at: string | null };

export function bearerOf(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

// The owner signs in with the ADMIN_TOKEN secret that the Deploy to Cloudflare form asks for, or,
// when it is set up, through Cloudflare Access. Agent tokens are minted by the owner and stored as
// SHA-256 hashes. A bearer token wins over an Access sign-in.
export async function authenticate(request: Request, env: Env, ctx: ExecutionContext): Promise<Access> {
  const token = bearerOf(request);
  const access = accessConfig(env);
  const jwt = access ? accessJwtOf(request) : null;
  if (!token && access && jwt) {
    const email = await verifyAccessJwt(jwt, access);
    return { agentId: ADMIN_AGENT_ID, tokenId: "access", scopes: ["read", "write"], admin: true, via: "access", email };
  }
  if (!token) throw new PantryError("unauthorized", "Bearer token required");
  const tokenHash = await sha256Hex(token);

  const admin = env.ADMIN_TOKEN?.trim();
  if (!admin || admin.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new PantryError("misconfigured", `ADMIN_TOKEN must be set to at least ${MIN_ADMIN_TOKEN_LENGTH} characters`);
  }
  if (timingSafeEqual(tokenHash, await sha256Hex(admin))) {
    return { agentId: ADMIN_AGENT_ID, tokenId: "admin", scopes: ["read", "write"], admin: true, via: "admin_token" };
  }

  const row = await env.DB.prepare(
    `SELECT t.id AS token_id, t.agent_id, t.scopes, t.revoked_at, a.disabled_at
     FROM tokens t JOIN agents a ON a.id = t.agent_id WHERE t.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<TokenRow>();
  if (!row || row.revoked_at || row.disabled_at) throw new PantryError("unauthorized", "Token is not valid");

  const now = new Date();
  const staleBefore = new Date(now.getTime() - 60_000).toISOString();
  ctx.waitUntil(
    env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)")
      .bind(now.toISOString(), row.token_id, staleBefore)
      .run()
      .then(() => undefined, () => undefined),
  );
  return { agentId: row.agent_id, tokenId: row.token_id, scopes: parseScopes(row.scopes), admin: false, via: "agent_token" };
}

export function parseScopes(stored: string): Scope[] {
  return stored.split(",").filter((scope): scope is Scope => scope === "read" || scope === "write");
}

export function requireScope(access: Access, scope: Scope): void {
  if (!access.scopes.includes(scope)) throw new PantryError("forbidden", `This token lacks the ${scope} scope`);
}

export function requireAdmin(access: Access): void {
  if (!access.admin) throw new PantryError("forbidden", "Only the admin token can do this");
}
