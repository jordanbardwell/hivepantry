import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { adoptTimeZone, zoneOf } from "../src/time";
import { ADMIN, mint, reset, rest } from "./helpers";

beforeEach(reset);

// The deploy form asks only for ADMIN_TOKEN, so the zone comes from the console's first sign-in.
const noFixedZone = { ...(env as Env), PANTRY_TZ: undefined } as Env;

describe("time zone", () => {
  it("is UTC until the console stores the browser's zone, and keeps the first zone", async () => {
    expect(await zoneOf(noFixedZone)).toBe("UTC");
    expect(await adoptTimeZone(noFixedZone, "Europe/Berlin")).toEqual({ time_zone: "Europe/Berlin" });
    expect(await adoptTimeZone(noFixedZone, "Asia/Tokyo")).toEqual({ time_zone: "Europe/Berlin" });
    expect(await zoneOf(noFixedZone)).toBe("Europe/Berlin");
  });

  it("ignores a zone that is not an IANA zone", async () => {
    expect(await adoptTimeZone(noFixedZone, "Mars/Olympus")).toEqual({ time_zone: "UTC" });
    expect(await adoptTimeZone(noFixedZone, 42)).toEqual({ time_zone: "UTC" });
  });

  it("lets PANTRY_TZ win over the stored zone", async () => {
    await adoptTimeZone(noFixedZone, "Europe/Berlin");
    expect(await zoneOf(env as Env)).toBe("America/New_York");
  });

  it("is a console admin route only", async () => {
    const body = JSON.stringify({ time_zone: "Europe/Berlin" });
    expect((await rest("/console/api/admin/time-zone", ADMIN, { method: "POST", body })).json.data).toEqual({ time_zone: "America/New_York" });
    const agent = await mint("claude");
    expect((await rest("/v1/admin/time-zone", agent, { method: "POST", body })).status).toBe(403);
  });
});
