import page from "./console.html";
import { APP_NAME } from "./brand";

// The owner console is one static page. It holds no data: it asks for the admin token and calls
// the /v1 API with it, so serving the page needs no auth. A fresh nonce per response lets the
// page's own script and style run under a CSP that allows nothing else.
export const CONSOLE_PATH = "/console";

export function consoleResponse(request: Request, url: URL): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (url.pathname === "/") return Response.redirect(new URL(CONSOLE_PATH, url).toString(), 302);
  if (url.pathname !== CONSOLE_PATH && url.pathname !== `${CONSOLE_PATH}/`) return null;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const body = page.replaceAll("__CSP_NONCE__", nonce).replaceAll("__APP_NAME__", APP_NAME);
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}
