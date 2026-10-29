import { SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyAccessJwt } from "../src/access";

// These tests do not prime the key cache. The worker loads the team keys from the certs URL, as it
// does in production, from a stubbed fetch.
const TEAM = "keys.cloudflareaccess.com";
const AUD = "keys-aud";
const config = { team: TEAM, aud: AUD };

type Pair = { privateKey: CryptoKey; jwk: JsonWebKey };
let k1: Pair;
let k2: Pair;
let served: JsonWebKey[] = [];
let certFetches = 0;

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function pair(kid: string): Promise<Pair> {
  const keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return { privateKey: keys.privateKey, jwk: { ...((await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey), kid } as JsonWebKey };
}

async function jwt(claims: Record<string, unknown>, key: CryptoKey, header: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 600, email: "jordan@example.com", ...claims }))}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body)));
  return `${body}.${b64url(signature)}`;
}

beforeAll(async () => {
  k1 = await pair("k1");
  k2 = await pair("k2");
  served = [k1.jwk];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host === TEAM && url.pathname === "/cdn-cgi/access/certs") {
      certFetches++;
      return Response.json({ keys: served });
    }
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => vi.useRealTimers());

describe("Cloudflare Access team keys", () => {
  it("loads the keys from the team certs URL once, then from the cache", async () => {
    const token = await jwt({}, k1.privateKey, { alg: "RS256", kid: "k1" });
    await expect(verifyAccessJwt(token, config)).resolves.toBe("jordan@example.com");
    await expect(verifyAccessJwt(token, config)).resolves.toBe("jordan@example.com");
    expect(certFetches).toBe(1);
  });

  it("loads the keys again for a new kid, but at most once a minute", async () => {
    const before = certFetches;
    const junk = await jwt({}, k1.privateKey, { alg: "RS256", kid: "junk" });
    // The cache is new, so the first unknown kid must wait a minute before a refetch.
    for (let i = 0; i < 3; i++) await expect(verifyAccessJwt(junk, config)).rejects.toThrow();
    expect(certFetches).toBe(before);

    served = [k1.jwk, k2.jwk];
    const rotated = await jwt({}, k2.privateKey, { alg: "RS256", kid: "k2" });
    await expect(verifyAccessJwt(rotated, config, Date.now())).rejects.toThrow();
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    await expect(verifyAccessJwt(rotated, config)).resolves.toBe("jordan@example.com");
    expect(certFetches).toBe(before + 1);
  });

  it("refuses alg none, an unsigned token, and a token that is not valid yet", async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = b64url(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 600 }));
    await expect(verifyAccessJwt(`${b64url(JSON.stringify({ alg: "none", kid: "k1" }))}.${claims}.`, config)).rejects.toThrow();
    await expect(verifyAccessJwt(`${b64url(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${claims}.`, config)).rejects.toThrow();
    await expect(verifyAccessJwt(await jwt({ nbf: now + 3600 }, k1.privateKey, { alg: "RS256", kid: "k1" }), config)).rejects.toThrow();
  });

  it("refuses the console API when the certs URL fails", async () => {
    // The worker's env names another team, whose certs URL the stub does not serve.
    const response = await SELF.fetch("https://pantry.test/console/api/admin/agents", {
      headers: { "cf-access-jwt-assertion": await jwt({}, k1.privateKey, { alg: "RS256", kid: "other" }) },
    });
    expect(response.status).toBe(401);
  });
});
