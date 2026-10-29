import { describe, expect, it } from "vitest";
import { CloudflareApiError, ensureConsoleAccess, ensureWorkersDev, liveAccessVars, ownerEmails, type CfFetch } from "../scripts/access-setup.ts";

// An in-memory stand-in for the parts of the Cloudflare API that the deploy uses.
function fakeApi(start: { org?: boolean; idps?: number } = {}) {
  const state = {
    org: start.org ? { auth_domain: "existing.cloudflareaccess.com" } : null,
    idps: Array.from({ length: start.idps ?? 0 }, (_, i) => ({ id: `idp${i}` })),
    apps: [] as { id: string; aud: string; domain: string; name: string; same_site_cookie_attribute?: string }[],
    policies: new Map<string, { id: string; name: string; include: unknown }[]>(),
    calls: [] as string[],
  };
  const cf: CfFetch = async (path, init = {}) => {
    const method = init.method ?? "GET";
    state.calls.push(`${method} ${path}`);
    const body = init.body as any;
    const base = "/accounts/acc";
    if (path === `${base}/workers/subdomain`) return { subdomain: "jordan" };
    if (path === `${base}/access/organizations`) {
      if (method === "POST") return (state.org = { auth_domain: body.auth_domain });
      if (!state.org) throw new CloudflareApiError(404, "no org");
      return state.org;
    }
    if (path === `${base}/access/identity_providers`) {
      if (method === "POST") state.idps.push({ id: body.type });
      return state.idps;
    }
    if (path === `${base}/access/apps`) {
      if (method === "POST") {
        const app = { id: `app${state.apps.length}`, aud: `aud${state.apps.length}`, domain: body.domain, name: body.name, same_site_cookie_attribute: body.same_site_cookie_attribute };
        state.apps.push(app);
        return app;
      }
      return state.apps;
    }
    const appMatch = /^\/accounts\/acc\/access\/apps\/([^/]+)$/.exec(path);
    if (appMatch && method === "PUT") {
      const app = state.apps.find((a) => a.id === appMatch[1])!;
      return Object.assign(app, { name: body.name, domain: body.domain, same_site_cookie_attribute: body.same_site_cookie_attribute });
    }
    const policyMatch = /^\/accounts\/acc\/access\/apps\/([^/]+)\/policies(?:\/([^/]+))?$/.exec(path);
    if (policyMatch) {
      const list = state.policies.get(policyMatch[1]!) ?? [];
      state.policies.set(policyMatch[1]!, list);
      if (method === "POST") list.push({ id: `pol${list.length}`, name: body.name, include: body.include });
      if (method === "PUT") Object.assign(list.find((p) => p.id === policyMatch[2])!, { include: body.include });
      return list;
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { cf, state };
}

const options = { accountId: "acc", workerName: "hivepantry", appName: "HivePantry", emails: ["me@example.com"] };

describe("console Access setup", () => {
  it("makes the organization, a login method, the app on /console only, and the owner policy", async () => {
    const { cf, state } = fakeApi();
    const result = await ensureConsoleAccess(cf, options);
    expect(result).toEqual({ team: "jordan.cloudflareaccess.com", aud: "aud0", host: "hivepantry.jordan.workers.dev" });
    expect(state.apps.map((a) => a.domain)).toEqual(["hivepantry.jordan.workers.dev/console"]);
    expect(state.apps[0]!.same_site_cookie_attribute).toBe("lax");
    expect(state.idps).toEqual([{ id: "onetimepin" }]);
    expect(state.policies.get("app0")).toEqual([{ id: "pol0", name: "Owner", include: [{ email: { email: "me@example.com" } }] }]);
  });

  it("reuses what exists and updates the owner emails on the next deploy", async () => {
    const { cf, state } = fakeApi({ org: true, idps: 1 });
    await ensureConsoleAccess(cf, options);
    const again = await ensureConsoleAccess(cf, { ...options, emails: ["me@example.com", "you@example.com"] });
    expect(again.team).toBe("existing.cloudflareaccess.com");
    expect(state.apps).toHaveLength(1);
    expect(again.aud).toBe("aud0");
    expect(state.calls).toContain("PUT /accounts/acc/access/apps/app0");
    expect(state.idps).toHaveLength(1);
    expect(state.policies.get("app0")).toHaveLength(1);
    expect(state.policies.get("app0")![0]!.include).toHaveLength(2);
    expect(state.calls.some((c) => c.includes("/mcp") || c.includes("/v1"))).toBe(false);
  });

  it("reads the Access vars of the live worker, so a failed setup does not turn them off", async () => {
    const settings = (bindings: unknown[]): CfFetch => async (path) => {
      expect(path).toBe("/accounts/acc/workers/scripts/hivepantry/settings");
      return { bindings };
    };
    const live = [
      { type: "plain_text", name: "ACCESS_TEAM_DOMAIN", text: "t.cloudflareaccess.com" },
      { type: "plain_text", name: "ACCESS_AUD", text: "aud9" },
      { type: "d1", name: "DB" },
    ];
    expect(await liveAccessVars(settings(live), "acc", "hivepantry")).toEqual(["--var", "ACCESS_TEAM_DOMAIN:t.cloudflareaccess.com", "--var", "ACCESS_AUD:aud9"]);
    expect(await liveAccessVars(settings([{ type: "plain_text", name: "ACCESS_AUD", text: "" }]), "acc", "hivepantry")).toEqual([]);
  });

  it("parses owner emails", () => {
    expect(ownerEmails(" Me@Example.com, bad, you@example.com ,")).toEqual(["me@example.com", "you@example.com"]);
    expect(ownerEmails(undefined)).toEqual([]);
  });
});

describe("ensureWorkersDev", () => {
  function api(enabled: boolean) {
    const calls: string[] = [];
    const cf: CfFetch = async (path, init = {}) => {
      calls.push(`${init.method ?? "GET"} ${path}`);
      if (path === "/accounts/acc/workers/subdomain") return { subdomain: "jordan" };
      if (path === "/accounts/acc/workers/scripts/hivepantry/subdomain") {
        if (init.method === "POST") {
          expect(init.body).toEqual({ enabled: true, previews_enabled: true });
          enabled = true;
        }
        return { enabled, previews_enabled: enabled };
      }
      throw new Error(`unexpected ${path}`);
    };
    return { cf, calls };
  }

  it("turns on the workers.dev address when it is off", async () => {
    const { cf, calls } = api(false);
    expect(await ensureWorkersDev(cf, "acc", "hivepantry")).toBe("hivepantry.jordan.workers.dev");
    expect(calls).toContain("POST /accounts/acc/workers/scripts/hivepantry/subdomain");
  });

  it("changes nothing when it is on", async () => {
    const { cf, calls } = api(true);
    await ensureWorkersDev(cf, "acc", "hivepantry");
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
});
