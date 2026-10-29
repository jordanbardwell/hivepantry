declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.html" {
  const content: string;
  export default content;
}

// Optional worker vars. wrangler.jsonc declares none, so the deploy form asks only for ADMIN_TOKEN.
// You set PANTRY_TZ and OWNER_EMAIL in the dashboard; the deploy script sets the rest.
interface Env {
  PANTRY_TZ?: string;
  OWNER_EMAIL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  GIT_SHA?: string;
}
