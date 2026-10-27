import { PantryError } from "./errors";

// Optional Cloudflare Access sign-in for the owner. When ACCESS_TEAM_DOMAIN and ACCESS_AUD are set,
// a request that Access let through carries a signed JWT in Cf-Access-Jwt-Assertion. A JWT that
// verifies against the team's keys, for this application's audience, signs the caller in as the
// owner. Who may sign in is decided by the Access policy, not here.

type Jwk = JsonWebKey & { kid?: string };
type Claims = { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string; sub?: string };

const KEY_TTL_MS = 60 * 60 * 1000;
const REFETCH_MIN_MS = 60 * 1000;
const keyCache = new Map<string, { fetched: number; exp: number; keys: Jwk[] }>();

export function accessConfig(env: Env): { team: string; aud: string } | null {
  const team = (env.ACCESS_TEAM_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = (env.ACCESS_AUD ?? "").trim();
  return team && aud ? { team, aud } : null;
}

// Tests prime the cache instead of fetching the certs endpoint.
export function primeAccessKeys(team: string, keys: Jwk[]): void {
  keyCache.set(team, { fetched: Date.now(), exp: Date.now() + KEY_TTL_MS, keys });
}

async function teamKeys(team: string, refresh: boolean): Promise<Jwk[]> {
  const cached = keyCache.get(team);
  // A refresh for an unknown kid refetches at most once a minute, so junk JWTs cannot drive fetches.
  if (cached && cached.exp > Date.now() && (!refresh || Date.now() - cached.fetched < REFETCH_MIN_MS)) return cached.keys;
  const response = await fetch(`https://${team}/cdn-cgi/access/certs`).catch(() => null);
  if (!response?.ok) throw new PantryError("unauthorized", "Could not load Cloudflare Access keys");
  const { keys } = (await response.json()) as { keys?: Jwk[] };
  primeAccessKeys(team, keys ?? []);
  return keys ?? [];
}

function decodePart<T>(part: string): T {
  const base64 = part.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as T;
}

function bytesOf(part: string): Uint8Array {
  const base64 = part.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

// Access injects the header only on paths it protects. The console page may be the only protected
// path, so its API calls are signed in by the CF_Authorization cookie, which holds the same JWT. A
// cookie counts only on a same-origin request, so another site cannot ride it.
export function accessJwtOf(request: Request): string | null {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header;
  const sameOrigin =
    request.headers.get("sec-fetch-site") === "same-origin" || request.headers.get("origin") === new URL(request.url).origin;
  if (!sameOrigin) return null;
  const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get("cookie") ?? "");
  return match?.[1] ?? null;
}

// Returns the signed-in email, or throws unauthorized.
export async function verifyAccessJwt(jwt: string, config: { team: string; aud: string }, now = Date.now()): Promise<string> {
  const invalid = () => new PantryError("unauthorized", "Cloudflare Access sign-in is not valid");
  const parts = jwt.split(".");
  if (parts.length !== 3) throw invalid();
  const [headerPart, claimsPart, signaturePart] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: Claims;
  try {
    header = decodePart(headerPart);
    claims = decodePart(claimsPart);
  } catch {
    throw invalid();
  }
  if (header.alg !== "RS256") throw invalid();

  let keys = await teamKeys(config.team, false);
  // Access rotates keys; one refetch covers a kid we have not seen yet.
  if (!keys.some((k) => k.kid === header.kid)) keys = await teamKeys(config.team, true);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw invalid();
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${headerPart}.${claimsPart}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytesOf(signaturePart), signed))) throw invalid();

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const seconds = now / 1000;
  if (!audiences.includes(config.aud)) throw invalid();
  if (claims.iss !== `https://${config.team}`) throw invalid();
  if (typeof claims.exp !== "number" || claims.exp <= seconds) throw invalid();
  if (typeof claims.nbf === "number" && claims.nbf > seconds + 60) throw invalid();
  return claims.email ?? claims.sub ?? "access-user";
}
