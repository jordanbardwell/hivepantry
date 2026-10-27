import { PantryError } from "./errors";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// PANTRY_TZ is an IANA zone. An unknown zone is a 500 rather than a log filed on the wrong day.
export function zoneOf(env: Env): string {
  const zone = env.PANTRY_TZ?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new PantryError("misconfigured", `PANTRY_TZ is not a known time zone: ${zone}`);
  }
  return zone;
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
