import { TOKEN_PREFIX } from "./brand";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// A ULID: sortable by creation time, so ids double as a stable tiebreak.
export function ulid(now = Date.now()): string {
  const chars = new Array<string>(26);
  let time = now;
  for (let i = 9; i >= 0; i--) {
    chars[i] = CROCKFORD[time % 32]!;
    time = Math.floor(time / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 10; i < 26; i++) chars[i] = CROCKFORD[bytes[i - 10]! & 31]!;
  return chars.join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const len = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// 256 random bits. The database keeps only the SHA-256 of a token, which cannot be reversed at
// this entropy, so no pepper secret is needed.
export function randomToken(agentId: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}_${agentId}_${base64Url(bytes)}`;
}
