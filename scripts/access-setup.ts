// Puts Cloudflare Access in front of the console, and only the console. The deploy calls this when
// OWNER_EMAIL is set. It makes what is missing and leaves the rest:
//   - the Zero Trust organization (team domain),
//   - a one-time PIN login method when the account has no login method,
//   - a self-hosted Access application for <worker>.<subdomain>.workers.dev/console,
//   - an "Owner" allow policy for the OWNER_EMAIL addresses, updated on each deploy.
// /mcp and /v1 are never in the application, so agents keep their bearer tokens.
// The result is the team domain and the application audience tag for the worker vars.

export type CfFetch = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;

type App = { id: string; aud: string; domain: string };
type Policy = { id: string; name: string };

// No parameter properties: Node runs this file with type stripping only.
export class CloudflareApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function cloudflareApi(token: string, fetchImpl: typeof fetch = fetch): CfFetch {
  return async (path, init = {}) => {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = (await response.json().catch(() => ({}))) as { success?: boolean; result?: unknown; errors?: { message?: string }[] };
    if (!response.ok || json.success === false) {
      const detail = json.errors?.map((e) => e.message).filter(Boolean).join("; ") || response.statusText;
      throw new CloudflareApiError(response.status, `${init.method ?? "GET"} ${path}: ${response.status} ${detail}`);
    }
    return json.result;
  };
}

export function ownerEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
}

export async function ensureConsoleAccess(
  cf: CfFetch,
  options: { accountId: string; workerName: string; appName: string; emails: string[] },
): Promise<{ team: string; aud: string; host: string }> {
  const account = `/accounts/${options.accountId}`;
  const { subdomain } = (await cf(`${account}/workers/subdomain`)) as { subdomain: string };
  const host = `${options.workerName}.${subdomain}.workers.dev`;
  const domain = `${host}/console`;

  let org: { auth_domain?: string } | null = null;
  try {
    org = (await cf(`${account}/access/organizations`)) as { auth_domain?: string } | null;
  } catch (err) {
    if (!(err instanceof CloudflareApiError) || err.status !== 404) throw err;
  }
  if (!org?.auth_domain) {
    // The workers.dev subdomain is unique, so it makes a free team name.
    org = (await cf(`${account}/access/organizations`, {
      method: "POST",
      body: { name: options.appName, auth_domain: `${subdomain}.cloudflareaccess.com` },
    })) as { auth_domain: string };
  }
  const team = org.auth_domain!;

  const idps = ((await cf(`${account}/access/identity_providers`)) as unknown[] | null) ?? [];
  if (!idps.length) {
    await cf(`${account}/access/identity_providers`, { method: "POST", body: { name: "One-time PIN", type: "onetimepin", config: {} } });
  }

  // SameSite=Lax keeps a page on another site from sending the session cookie with a POST. The
  // worker also checks Origin, so an app made before this setting is still safe.
  const appBody = {
    name: `${options.appName} console`,
    type: "self_hosted",
    domain,
    session_duration: "24h",
    app_launcher_visible: false,
    same_site_cookie_attribute: "lax",
    http_only_cookie_attribute: true,
  };
  const apps = ((await cf(`${account}/access/apps`)) as App[] | null) ?? [];
  const found = apps.find((a) => a.domain === domain);
  const app = (found
    ? await cf(`${account}/access/apps/${found.id}`, { method: "PUT", body: appBody })
    : await cf(`${account}/access/apps`, { method: "POST", body: appBody })) as App;

  const policy = {
    name: "Owner",
    decision: "allow",
    include: options.emails.map((email) => ({ email: { email } })),
  };
  const policies = ((await cf(`${account}/access/apps/${app.id}/policies`)) as Policy[] | null) ?? [];
  const owner = policies.find((p) => p.name === "Owner");
  if (owner) await cf(`${account}/access/apps/${app.id}/policies/${owner.id}`, { method: "PUT", body: policy });
  else await cf(`${account}/access/apps/${app.id}/policies`, { method: "POST", body: policy });

  return { team, aud: app.aud, host };
}
