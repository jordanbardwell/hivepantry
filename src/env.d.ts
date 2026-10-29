declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.html" {
  const content: string;
  export default content;
}

// Vars that wrangler.jsonc does not declare. The deploy script sets them.
interface Env {
  OWNER_EMAIL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  GIT_SHA?: string;
}
