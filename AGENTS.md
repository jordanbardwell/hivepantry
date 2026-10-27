# Rules for this repository

- `src/tools.ts` has the only list of tools. MCP and REST both read it. To add a tool, add it there. Put its zod schema in `src/schemas.ts`. Put its logic in `src/service.ts`.
- For a schema change, add a new numbered file in `migrations/`. Do not change a migration that a deploy applied.
- `wrangler.jsonc` is the Deploy to Cloudflare configuration. Do not put a `database_id`, an account ID, or a secret in it.
- `src/brand.ts` has the product name. `docs/architecture.md` has the rename checklist.
- Write the README and the user documents in ASD-STE100 Simplified Technical English.
- Run `pnpm typecheck` and `pnpm test` before you push.
