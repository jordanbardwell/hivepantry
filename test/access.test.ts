import { SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { primeAccessKeys } from "../src/access";
import { mint, reset } from "./helpers";

const TEAM = "test.cloudflareaccess.com";
const AUD = "test-aud";
let signer: CryptoKey;
let stranger: CryptoKey;

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function keyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

async function jwt(claims: Record<string, unknown>, key = signer, kid = "k1"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64url(JSON.stringify({ alg: "RS256", kid }))}.${b64url(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 600, iat: now, email: "jordan@example.com", ...claims }))}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body)));
  return `${body}.${b64url(signature)}`;
}

async function whoami(headers: Record<string, string>) {
  const response = await SELF.fetch("https://pantry.test/v1/tools/whoami", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  return { status: response.status, json: (await response.json()) as any };
}

beforeAll(async () => {
  const pair = await keyPair();
  signer = pair.privateKey;
  stranger = (await keyPair()).privateKey;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  primeAccessKeys(TEAM, [{ ...jwk, kid: "k1" }]);
});
beforeEach(reset);

describe("Cloudflare Access sign-in", () => {
  it("signs a valid Access JWT in as the owner", async () => {
    const result = await whoami({ "cf-access-jwt-assertion": await jwt({}) });
    expect(result.status).toBe(200);
    expect(result.json.data).toMatchObject({ agent_id: "owner", admin: true, signed_in_with: "access", email: "jordan@example.com" });
  });

  it("refuses a JWT for another audience, issuer, signer, or that has expired", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const token of [
      await jwt({ aud: ["other-app"] }),
      await jwt({ iss: "https://evil.cloudflareaccess.com" }),
      await jwt({ exp: now - 10 }),
      await jwt({}, stranger),
      "not.a.jwt",
    ]) {
      expect((await whoami({ "cf-access-jwt-assertion": token })).status).toBe(401);
    }
  });

  it("accepts the CF_Authorization cookie only on a same-origin request", async () => {
    const cookie = `other=1; CF_Authorization=${await jwt({})}`;
    expect((await whoami({ cookie, "sec-fetch-site": "same-origin" })).json.data).toMatchObject({ signed_in_with: "access" });
    expect((await whoami({ cookie, origin: "https://pantry.test" })).status).toBe(200);
    expect((await whoami({ cookie, origin: "https://evil.test", "sec-fetch-site": "cross-site" })).status).toBe(401);
    expect((await whoami({ cookie })).status).toBe(401);
  });

  it("lets a bearer token win over the Access header", async () => {
    const agent = await mint("claude");
    const result = await whoami({ authorization: `Bearer ${agent}`, "cf-access-jwt-assertion": await jwt({}) });
    expect(result.json.data).toMatchObject({ agent_id: "claude", admin: false, signed_in_with: "agent_token" });
  });

  it("still needs a bearer token on /mcp", async () => {
    const response = await SELF.fetch("https://pantry.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "cf-access-jwt-assertion": await jwt({}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });
});
