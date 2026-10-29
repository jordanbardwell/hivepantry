import { PantryError } from "./errors";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// The day boundary zone: PANTRY_TZ if you set it on the worker, else the zone that the console
// stored from the browser, else UTC. An unknown PANTRY_TZ is a 500 rather than a log filed on the
// wrong day.
export async function zoneOf(env: Env): Promise<string> {
  const fixed = env.PANTRY_TZ?.trim();
  if (fixed) {
    if (!isTimeZone(fixed)) throw new PantryError("misconfigured", `PANTRY_TZ is not a known time zone: ${fixed}`);
    return fixed;
  }
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'time_zone'").first<{ value: string }>();
  return row && isTimeZone(row.value) ? row.value : "UTC";
}

// Stores the browser's zone the first time the console signs in. A stored zone or PANTRY_TZ wins,
// so a sign-in from a laptop in a different zone does not move your days.
export async function adoptTimeZone(env: Env, zone: unknown): Promise<{ time_zone: string }> {
  if (typeof zone === "string" && isTimeZone(zone) && !env.PANTRY_TZ?.trim()) {
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('time_zone', ?, ?) ON CONFLICT (key) DO NOTHING")
      .bind(zone, new Date().toISOString())
      .run();
  }
  return { time_zone: await zoneOf(env) };
}

function parts(instant: Date, zone: string): Record<string, string> {
  const out: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  for (const part of format.formatToParts(instant)) out[part.type] = part.value;
  return out;
}

export function localDate(instant: Date, zone: string): string {
  const p = parts(instant, zone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localHour(instant: Date, zone: string): number {
  return Number(parts(instant, zone).hour);
}

export function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function parseInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new PantryError("invalid", `${field} is not an ISO 8601 time`);
  return parsed;
}
