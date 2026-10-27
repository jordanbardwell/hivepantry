import { handleFetch } from "./http";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleFetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
