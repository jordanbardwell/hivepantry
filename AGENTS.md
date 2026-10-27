# Working on this repository

- `src/tools.ts` is the one list of tools. MCP and REST both read it. Add a tool there, with its zod schema in `src/schemas.ts` and its logic in `src/service.ts`.
- Schema changes go in a new numbered file in `migrations/`. Never edit an applied migration.
- `wrangler.jsonc` is the Deploy to Cloudflare config. It must not name a `database_id`, an account id, or a secret.
- The product name lives in `src/brand.ts` and the rename checklist in `docs/architecture.md`.
- Run `pnpm typecheck` and `pnpm test` before you push.
