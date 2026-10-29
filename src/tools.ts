import type { z } from "zod";
import { requireScope, type Access, type Scope } from "./auth";
import * as s from "./schemas";
import * as svc from "./service";
import type { Ctx } from "./service";
import { zoneOf } from "./time";

// The one list of tools. MCP registers each one, and REST serves each at POST /v1/tools/<name>,
// so both surfaces always match.
export type Tool = {
  name: string;
  description: string;
  scope: Scope;
  schema: z.ZodObject;
  run: (ctx: Ctx, input: never) => unknown;
};

const tool = <S extends z.ZodObject>(name: string, scope: Scope, schema: S, description: string, run: (ctx: Ctx, input: z.infer<S>) => unknown): Tool => ({
  name,
  scope,
  schema,
  description,
  run: run as Tool["run"],
});

export const GUIDE = [
  "This server keeps one person's food log: calories and macronutrients per day, daily goals, and body weight.",
  "- Days follow the pantry time zone (see whoami). Send date as YYYY-MM-DD, or consumed_at as an ISO time, to log a past meal.",
  "- To log food: call search_foods first. If the food is saved, call log_food with food_id and servings (or grams).",
  "  If not, call log_food with name, calories, protein_g, carbs_g, and fat_g per serving. Estimate from typical values when there is no label, and say so to the person.",
  "  Add save_food: true for a food the person eats often, so next time it is one search away.",
  "- For a dish the person cooked, call save_recipe with every ingredient and the amount that went in, and total_grams: the weight of the finished batch",
  "  after cooking, without the pot. Then log it with log_food, food_id, and grams eaten (or servings). Cooking changes the weight, so ask the person to weigh the batch.",
  "  Weigh ingredients as their nutrients describe them, usually raw. A recipe is a saved food, so search_foods finds it; kind: \"recipe\" lists only recipes.",
  "  get_recipe shows the ingredients, per serving and per 100 g amounts, and how much of the current batch is left. When the person cooks it again,",
  "  call save_recipe with its id and the new ingredients or total_grams. Read the warnings in the reply and tell the person about them.",
  "- Every log_food reply carries the day's totals and what is left of each goal, so you rarely need a second call.",
  "- Send an idempotency_key with each log_food and log_weight, so a retry never logs twice.",
  "- Fix mistakes with update_entry or delete_entry. Past entries keep the nutrients they were logged with, even if the saved food changes later.",
  "- get_day shows one day by meal. get_trends shows daily totals and averages over a range. set_goals sets daily targets.",
].join("\n");

export const TOOLS: Tool[] = [
  tool("whoami", "read", s.empty, "Return your agent id, scopes, the pantry time zone, and today's date there.", (ctx) => svc.whoami(ctx)),
  tool("guide", "read", s.empty, "Explain how to log food and read totals. Call this first if you are new here.", () => ({ guide: GUIDE })),
  tool("search_foods", "read", s.searchFoodsSchema, "Search saved foods and recipes by name, brand, or barcode. With no query, list the most-logged foods.", svc.searchFoods),
  tool(
    "save_food",
    "write",
    s.saveFoodSchema,
    "Save a food to the library with its per-serving nutrients. Saving the same name and brand again updates it. Fields you leave out keep their saved values.",
    svc.saveFood,
  ),
  tool("delete_food", "write", s.idSchema, "Remove a saved food or recipe from the library. Entries already logged keep their nutrients.", svc.deleteFood),
  tool(
    "save_recipe",
    "write",
    s.saveRecipeSchema,
    "Save a dish made from other foods. Send each ingredient and its amount, and total_grams, the cooked weight of the whole batch. Calculates per-serving and per-100 g nutrients, and saves the recipe as a food that log_food can log by grams or servings. Saving the same name again updates it.",
    svc.saveRecipe,
  ),
  tool("get_recipe", "read", s.idSchema, "Show a recipe: its ingredients, batch totals, per-serving and per-100 g nutrients, and how much of the current batch is left.", svc.getRecipe),
  tool(
    "log_food",
    "write",
    s.logFoodSchema,
    "Log food that was eaten. Send food_id from search_foods, or name with per-serving calories, protein_g, carbs_g, and fat_g. Returns the entry and the day's totals and remaining goals.",
    svc.logFood,
  ),
  tool("update_entry", "write", s.updateEntrySchema, "Change the servings, grams, meal, day, time, or note of a logged entry.", svc.updateEntry),
  tool("delete_entry", "write", s.idSchema, "Delete a logged entry.", svc.deleteEntry),
  tool("get_day", "read", s.dateSchema, "Show one day: entries by meal, totals, goals, and what is left of each goal.", svc.getDay),
  tool("get_trends", "read", s.rangeSchema, "Daily totals over a range (default the last 7 days), the average per logged day, and how it compares to the goals.", svc.getTrends),
  tool("get_goals", "read", s.dateSchema, "Show the daily goals that apply on a day.", svc.getGoals),
  tool("set_goals", "write", s.setGoalsSchema, "Set daily targets for calories and nutrients from a day onward. Goals you leave out keep their value unless replace is true.", svc.setGoals),
  tool("log_weight", "write", s.logWeightSchema, "Log a body weight in kg or lb. Returns the change since the previous weigh-in.", svc.logWeight),
  tool("get_weights", "read", s.rangeSchema, "List weigh-ins over a range (default the last 30 days) with the change from first to last.", svc.getWeights),
  tool("delete_weight", "write", s.idSchema, "Delete a logged weight.", svc.deleteWeight),
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Shared by REST and MCP: scope check, input validation, then the tool itself.
export async function callTool(env: Env, access: Access, tool: Tool, args: unknown): Promise<unknown> {
  requireScope(access, tool.scope);
  const input = tool.schema.parse(args);
  return tool.run({ env, access, zone: zoneOf(env), now: new Date() }, input as never);
}
