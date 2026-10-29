import { accessConfig, verifyAccessJwt } from "./access";
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
export const MIN_ADMIN_TOKEN_LENGTH = 8;

type TokenRow = {
  token_id: string;
  agent_id: string;
  scopes: string;
  revoked_at: string | null;
  expires_at: string | null;
  disabled_at: string | null;
};

// Where a credential other than an agent token may sign in. Only the console API sits behind the
// Access application, and the owner's ADMIN_TOKEN belongs on the console and /v1/admin, not in an
// agent's config.
export type AuthOptions = { allowAccess?: boolean; allowAdmin?: boolean };

export function bearerOf(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

// The owner signs in with the ADMIN_TOKEN secret that the Deploy to Cloudflare form asks for, or,
// when it is set up, through Cloudflare Access. Agent tokens are minted by the owner and stored as
// SHA-256 hashes. A bearer token wins over an Access sign-in.
export async function authenticate(request: Request, env: Env, ctx: ExecutionContext, options: AuthOptions = {}): Promise<Access> {
  const token = bearerOf(request);
  const access = options.allowAccess ? accessConfig(env) : null;
  const jwt = access ? request.headers.get("cf-access-jwt-assertion") : null;
  if (!token && access && jwt) {
    const email = await verifyAccessJwt(jwt, access);
    // The Access policy decides who signs in. OWNER_EMAIL, when set, is a second check here.
    const owners = (env.OWNER_EMAIL ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (owners.length && !owners.includes(email.toLowerCase())) throw new PantryError("forbidden", "This Cloudflare Access account is not an owner");
    return { agentId: ADMIN_AGENT_ID, tokenId: "access", scopes: ["read", "write"], admin: true, via: "access", email };
  }
  if (!token) throw new PantryError("unauthorized", "Bearer token required");
  const tokenHash = await sha256Hex(token);
  const now = new Date();

  const row = await env.DB.prepare(
    `SELECT t.id AS token_id, t.agent_id, t.scopes, t.revoked_at, t.expires_at, a.disabled_at
     FROM tokens t JOIN agents a ON a.id = t.agent_id WHERE t.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<TokenRow>();
  if (row) {
    if (row.revoked_at || row.disabled_at || (row.expires_at && row.expires_at <= now.toISOString())) {
      throw new PantryError("unauthorized", "Token is not valid");
    }
    const staleBefore = new Date(now.getTime() - 60_000).toISOString();
    ctx.waitUntil(
      env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)")
        .bind(now.toISOString(), row.token_id, staleBefore)
        .run()
        .then(() => undefined, () => undefined),
    );
    return { agentId: row.agent_id, tokenId: row.token_id, scopes: parseScopes(row.scopes), admin: false, via: "agent_token" };
  }

  // Not an agent token, so the only match left is ADMIN_TOKEN. A person picks it, so each try
  // counts against a per-IP limit; agent tokens have 256 random bits and skip the limit.
  const admin = env.ADMIN_TOKEN?.trim();
  if (!admin || admin.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new PantryError("misconfigured", `ADMIN_TOKEN must be set to at least ${MIN_ADMIN_TOKEN_LENGTH} characters`);
  }
  const limit = await env.AUTH_LIMITER?.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" });
  if (limit && !limit.success) throw new PantryError("rate_limited", "Too many sign-in attempts. Wait one minute.");
  if (!timingSafeEqual(tokenHash, await sha256Hex(admin))) throw new PantryError("unauthorized", "Token is not valid");
  if (!options.allowAdmin) {
    throw new PantryError("forbidden", "ADMIN_TOKEN works only on the console and /v1/admin. Give agents an agent token.");
  }
  return { agentId: ADMIN_AGENT_ID, tokenId: "admin", scopes: ["read", "write"], admin: true, via: "admin_token" };
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
