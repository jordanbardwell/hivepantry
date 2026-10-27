import { z } from "zod";

export const MEALS = ["breakfast", "lunch", "dinner", "snack", "other"] as const;
export const NUTRIENTS = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
export type Nutrients = Record<Nutrient, number | null>;

const amount = z.number().min(0).max(100_000);
const date = z.string().describe("A day as YYYY-MM-DD in the pantry time zone. Defaults to today.");
const instant = z.string().describe("An ISO 8601 time, for example 2026-10-27T12:30:00-04:00.");
const idempotencyKey = z
  .string()
  .min(1)
  .max(200)
  .describe("Any unique string for this write. A retry with the same key returns the first result and writes nothing.");
const text = (max: number) => z.string().trim().max(max);

// Per-serving amounts. The four core values are required so every entry counts toward totals.
// Estimate them when a label is not at hand.
const coreNutrients = {
  calories: amount.describe("kcal per serving"),
  protein_g: amount.describe("grams of protein per serving"),
  carbs_g: amount.describe("grams of carbohydrate per serving"),
  fat_g: amount.describe("grams of fat per serving"),
};
const extraNutrients = {
  fiber_g: amount.nullable().optional().describe("grams of fiber per serving"),
  sugar_g: amount.nullable().optional().describe("grams of sugar per serving"),
  sodium_mg: amount.nullable().optional().describe("milligrams of sodium per serving"),
};
const serving = {
  serving_size: z.number().positive().max(100_000).optional().describe("How much one serving is, in serving_unit. Default 1."),
  serving_unit: text(40).min(1).optional().describe('The unit of serving_size, for example "g", "cup", "slice", "bar". Default "serving".'),
  serving_grams: z.number().positive().max(100_000).nullable().optional().describe("The weight of one serving in grams, if known. Lets you log by grams."),
};

export const empty = z.object({});

export const searchFoodsSchema = z.object({
  query: text(200).optional().describe("Words to match in the food name or brand. Leave empty to list the most-logged foods."),
  barcode: text(64).optional().describe("Exact barcode (UPC/EAN) to match."),
  limit: z.number().int().min(1).max(50).optional().describe("Default 10."),
});

export const saveFoodSchema = z.object({
  id: z.string().optional().describe("Update this saved food. Without it, a food with the same name and brand is updated, or a new one is made."),
  name: text(200).min(1),
  brand: text(200).nullable().optional(),
  ...serving,
  ...coreNutrients,
  ...extraNutrients,
  barcode: text(64).nullable().optional(),
  notes: text(1000).nullable().optional(),
});

export const idSchema = z.object({ id: z.string().min(1) });

export const logFoodSchema = z.object({
  food_id: z.string().optional().describe("A saved food from search_foods. Its per-serving amounts are copied into the entry."),
  name: text(200).min(1).optional().describe("For a food that is not saved: its name. Then also send calories, protein_g, carbs_g, and fat_g per serving."),
  brand: text(200).nullable().optional(),
  ...serving,
  calories: coreNutrients.calories.optional(),
  protein_g: coreNutrients.protein_g.optional(),
  carbs_g: coreNutrients.carbs_g.optional(),
  fat_g: coreNutrients.fat_g.optional(),
  ...extraNutrients,
  save_food: z.boolean().optional().describe("Also save this food to the library for next time. Only with name and nutrients."),
  servings: z.number().positive().max(1000).optional().describe("How many servings were eaten. Default 1."),
  grams: z.number().positive().max(100_000).optional().describe("Instead of servings: grams eaten. Needs serving_grams on the food."),
  meal: z.enum(MEALS).optional().describe("Defaults from the time of day."),
  date: date.optional(),
  consumed_at: instant.optional().describe("When it was eaten. Sets date when date is not sent."),
  note: text(500).nullable().optional(),
  idempotency_key: idempotencyKey.optional(),
});

export const updateEntrySchema = z.object({
  id: z.string().min(1),
  servings: z.number().positive().max(1000).optional(),
  grams: z.number().positive().max(100_000).optional(),
  meal: z.enum(MEALS).optional(),
  date: date.optional(),
  consumed_at: instant.nullable().optional(),
  note: text(500).nullable().optional(),
});

export const dateSchema = z.object({ date: date.optional() });

export const rangeSchema = z.object({
  from: date.optional().describe("First day, YYYY-MM-DD."),
  to: date.optional().describe("Last day, YYYY-MM-DD. Defaults to today."),
  days: z.number().int().min(1).max(366).optional().describe("Used when from is not sent: the number of days ending at to."),
});

const goal = amount.nullable().optional();
export const setGoalsSchema = z.object({
  calories: goal.describe("Daily kcal target. null clears it."),
  protein_g: goal,
  carbs_g: goal,
  fat_g: goal,
  fiber_g: goal,
  sugar_g: goal.describe("Daily sugar limit in grams."),
  sodium_mg: goal.describe("Daily sodium limit in milligrams."),
  effective_from: date.optional().describe("First day the goals apply. Defaults to today."),
  replace: z.boolean().optional().describe("true clears every goal not sent. By default goals not sent keep their current value."),
});

export const logWeightSchema = z.object({
  weight: z.number().positive().max(1000),
  unit: z.enum(["kg", "lb"]).describe("The unit of weight."),
  body_fat_pct: z.number().min(1).max(80).nullable().optional(),
  date: date.optional(),
  measured_at: instant.optional(),
  note: text(500).nullable().optional(),
  idempotency_key: idempotencyKey.optional(),
});

export const mintSchema = z.object({
  agent_id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "use 1-40 lowercase letters, digits, or '-'")
    .refine((id) => id !== "owner", "owner is reserved for the admin token"),
  name: text(100).optional(),
  scopes: z.array(z.enum(["read", "write"])).min(1).optional().describe('Default ["read", "write"].'),
  label: text(100).optional(),
});
