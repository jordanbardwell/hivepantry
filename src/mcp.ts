import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import type { Access } from "./auth";
import { APP_SLUG, VERSION } from "./brand";
import { errorBody, toPantryError } from "./errors";
import { callTool, GUIDE, TOOLS } from "./tools";

// The HTTP layer has already authenticated the request, so every tool call runs as `access`.
export function mcpHandler(request: Request, env: Env, ctx: ExecutionContext, access: Access): Promise<Response> {
  const handler = createMcpHandler(() => buildServer(env, access), { route: "/mcp" });
  return handler(request, env, ctx);
}

function buildServer(env: Env, access: Access): McpServer {
  const server = new McpServer({ name: APP_SLUG, version: VERSION }, { instructions: GUIDE });
  for (const tool of TOOLS) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema }, async (args: unknown) => {
      try {
        const data = await callTool(env, access, tool, args ?? {});
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, data }) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: errorBody(toPantryError(err)) }) }] };
      }
    });
  }
  return server;
}
