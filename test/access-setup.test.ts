import { describe, expect, it } from "vitest";
import { CloudflareApiError, ensureConsoleAccess, ownerEmails, type CfFetch } from "../scripts/access-setup.ts";

// An in-memory stand-in for the parts of the Cloudflare API that the deploy uses.
function fakeApi(start: { org?: boolean; idps?: number } = {}) {
  const state = {
    org: start.org ? { auth_domain: "existing.cloudflareaccess.com" } : null,
    idps: Array.from({ length: start.idps ?? 0 }, (_, i) => ({ id: `idp${i}` })),
    apps: [] as { id: string; aud: string; domain: string; name: string }[],
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
        const app = { id: `app${state.apps.length}`, aud: `aud${state.apps.length}`, domain: body.domain, name: body.name };
        state.apps.push(app);
        return app;
      }
      return state.apps;
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
    expect(state.idps).toEqual([{ id: "onetimepin" }]);
    expect(state.policies.get("app0")).toEqual([{ id: "pol0", name: "Owner", include: [{ email: { email: "me@example.com" } }] }]);
  });

  it("reuses what exists and updates the owner emails on the next deploy", async () => {
    const { cf, state } = fakeApi({ org: true, idps: 1 });
    await ensureConsoleAccess(cf, options);
    const again = await ensureConsoleAccess(cf, { ...options, emails: ["me@example.com", "you@example.com"] });
    expect(again.team).toBe("existing.cloudflareaccess.com");
    expect(state.apps).toHaveLength(1);
    expect(state.idps).toHaveLength(1);
    expect(state.policies.get("app0")).toHaveLength(1);
    expect(state.policies.get("app0")![0]!.include).toHaveLength(2);
    expect(state.calls.some((c) => c.includes("/mcp") || c.includes("/v1"))).toBe(false);
  });

  it("parses owner emails", () => {
    expect(ownerEmails(" Me@Example.com, bad, you@example.com ,")).toEqual(["me@example.com", "you@example.com"]);
    expect(ownerEmails(undefined)).toEqual([]);
  });
});
