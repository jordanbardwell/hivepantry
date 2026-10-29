import type { z } from "zod";
import type { Access } from "./auth";
import { APP_NAME, VERSION } from "./brand";
import { ulid } from "./crypto";
import { PantryError } from "./errors";
import {
  MEALS,
  NUTRIENTS,
  type dateSchema,
  type idSchema,
  type logFoodSchema,
  type logWeightSchema,
  type Nutrient,
  type Nutrients,
  type rangeSchema,
  type saveFoodSchema,
  type saveRecipeSchema,
  type searchFoodsSchema,
  type setGoalsSchema,
  type updateEntrySchema,
} from "./schemas";
import { addDays, daysBetween, isDate, localDate, localHour, parseInstant } from "./time";

export type Ctx = { env: Env; access: Access; zone: string; now: Date };

const CORE: Nutrient[] = ["calories", "protein_g", "carbs_g", "fat_g"];
const LB_PER_KG = 2.2046226218;
const MAX_RANGE_DAYS = 366;

type FoodRow = {
  id: string;
  name: string;
  brand: string | null;
  name_key: string;
  brand_key: string;
  serving_size: number;
  serving_unit: string;
  serving_grams: number | null;
  barcode: string | null;
  notes: string | null;
  log_count: number;
  last_logged_at: string | null;
  recipe_servings: number | null;
  recipe_total_grams: number | null;
  recipe_batch_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
} & Nutrients;

type EntryRow = {
  id: string;
  local_date: string;
  consumed_at: string | null;
  meal: (typeof MEALS)[number];
  food_id: string | null;
  name: string;
  brand: string | null;
  servings: number;
  serving_size: number | null;
  serving_unit: string | null;
  serving_grams: number | null;
  note: string | null;
  agent_id: string;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
} & Nutrients;

type IngredientRow = {
  id: string;
  recipe_id: string;
  position: number;
  food_id: string | null;
  name: string;
  brand: string | null;
  servings: number;
  serving_size: number | null;
  serving_unit: string | null;
  serving_grams: number | null;
  note: string | null;
  created_at: string;
} & Nutrients;

type GoalRow = { effective_from: string } & Nutrients;

type WeightRow = {
  id: string;
  local_date: string;
  measured_at: string | null;
  weight_kg: number;
  body_fat_pct: number | null;
  note: string | null;
  agent_id: string;
  idempotency_key: string | null;
  created_at: string;
};

// ---------- helpers ----------

function round(value: number | null, digits = 1): number | null {
  if (value === null) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function nutrientsOf(row: Partial<Nutrients>): Nutrients {
  return Object.fromEntries(NUTRIENTS.map((n) => [n, row[n] ?? null])) as Nutrients;
}

function rounded(values: Nutrients): Nutrients {
  return Object.fromEntries(NUTRIENTS.map((n) => [n, round(values[n])])) as Nutrients;
}

function scaled(perServing: Nutrients, servings: number): Nutrients {
  return Object.fromEntries(NUTRIENTS.map((n) => [n, perServing[n] === null ? null : perServing[n]! * servings])) as Nutrients;
}

// Core nutrients sum to a number. An optional nutrient is null when no entry reported it.
function sum(items: Nutrients[]): Nutrients {
  const out = {} as Nutrients;
  for (const n of NUTRIENTS) {
    let total: number | null = CORE.includes(n) ? 0 : null;
    for (const item of items) if (item[n] !== null) total = (total ?? 0) + item[n]!;
    out[n] = total;
  }
  return out;
}

function remaining(goals: Nutrients | null, totals: Nutrients): Partial<Record<Nutrient, number>> {
  const out: Partial<Record<Nutrient, number>> = {};
  if (!goals) return out;
  for (const n of NUTRIENTS) if (goals[n] !== null) out[n] = round(goals[n]! - (totals[n] ?? 0))!;
  return out;
}

function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function isUniqueViolation(err: unknown): boolean {
  return String(err instanceof Error ? err.message : err).includes("UNIQUE constraint failed");
}

export function today(ctx: Ctx): string {
  return localDate(ctx.now, ctx.zone);
}

function resolveDate(ctx: Ctx, value: string | undefined, field = "date"): string {
  if (value === undefined) return today(ctx);
  if (!isDate(value)) throw new PantryError("invalid", `${field} must be a real day as YYYY-MM-DD`);
  return value;
}

function resolveRange(ctx: Ctx, input: z.infer<typeof rangeSchema>, defaultDays: number): { from: string; to: string } {
  const to = resolveDate(ctx, input.to, "to");
  const from = input.from !== undefined ? resolveDate(ctx, input.from, "from") : addDays(to, -((input.days ?? defaultDays) - 1));
  if (from > to) throw new PantryError("invalid", "from must be on or before to");
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw new PantryError("invalid", `A range covers at most ${MAX_RANGE_DAYS} days`);
  return { from, to };
}

// A meal from the local hour, used only when the caller sends none.
function mealFor(hour: number | null): (typeof MEALS)[number] {
  if (hour === null) return "other";
  if (hour >= 4 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 17 && hour < 22) return "dinner";
  return "snack";
}

// ---------- output shapes ----------

function foodOut(row: FoodRow) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    serving_size: row.serving_size,
    serving_unit: row.serving_unit,
    serving_grams: row.serving_grams,
    per_serving: nutrientsOf(row),
    barcode: row.barcode,
    notes: row.notes,
    is_recipe: row.recipe_servings !== null,
    log_count: row.log_count,
    last_logged_at: row.last_logged_at,
    updated_at: row.updated_at,
  };
}

function entryOut(row: EntryRow) {
  const perServing = nutrientsOf(row);
  return {
    id: row.id,
    date: row.local_date,
    consumed_at: row.consumed_at,
    meal: row.meal,
    food_id: row.food_id,
    name: row.name,
    brand: row.brand,
    servings: round(row.servings, 3),
    grams: row.serving_grams === null ? null : round(row.servings * row.serving_grams),
    serving_size: row.serving_size,
    serving_unit: row.serving_unit,
    serving_grams: row.serving_grams,
    per_serving: perServing,
    totals: rounded(scaled(perServing, row.servings)),
    note: row.note,
    agent_id: row.agent_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function weightOut(row: WeightRow) {
  return {
    id: row.id,
    date: row.local_date,
    measured_at: row.measured_at,
    weight_kg: round(row.weight_kg, 2),
    weight_lb: round(row.weight_kg * LB_PER_KG, 1),
    body_fat_pct: row.body_fat_pct,
    note: row.note,
    agent_id: row.agent_id,
  };
}

// ---------- reads shared by several tools ----------

async function goalsFor(env: Env, date: string): Promise<GoalRow | null> {
  return env.DB.prepare("SELECT * FROM goals WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1").bind(date).first<GoalRow>();
}

async function entriesFor(env: Env, date: string): Promise<EntryRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM entries WHERE local_date = ? AND deleted_at IS NULL ORDER BY COALESCE(consumed_at, created_at), id",
  )
    .bind(date)
    .all<EntryRow>();
  return result.results;
}

async function dayTotals(env: Env, date: string) {
  const [entries, goal] = await Promise.all([entriesFor(env, date), goalsFor(env, date)]);
  const totals = sum(entries.map((e) => scaled(nutrientsOf(e), e.servings)));
  const goals = goal ? nutrientsOf(goal) : null;
  return { date, entry_count: entries.length, totals: rounded(totals), goals, remaining: remaining(goals, totals) };
}

async function loadFood(env: Env, id: string): Promise<FoodRow> {
  const food = await env.DB.prepare("SELECT * FROM foods WHERE id = ? AND deleted_at IS NULL").bind(id).first<FoodRow>();
  if (!food) throw new PantryError("not_found", `No saved food with id ${id}`);
  return food;
}

async function loadEntry(env: Env, id: string): Promise<EntryRow> {
  const entry = await env.DB.prepare("SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL").bind(id).first<EntryRow>();
  if (!entry) throw new PantryError("not_found", `No entry with id ${id}`);
  return entry;
}

// ---------- tools ----------

export function whoami(ctx: Ctx) {
  return {
    service: APP_NAME,
    version: VERSION,
    agent_id: ctx.access.agentId,
    admin: ctx.access.admin,
    signed_in_with: ctx.access.via,
    ...(ctx.access.email ? { email: ctx.access.email } : {}),
    scopes: ctx.access.scopes,
    time_zone: ctx.zone,
    today: today(ctx),
  };
}

export async function searchFoods(ctx: Ctx, input: z.infer<typeof searchFoodsSchema>) {
  const words = nameKey(input.query ?? "").split(" ").filter(Boolean).slice(0, 8);
  const binds: unknown[] = [];
  let sql = "SELECT * FROM foods WHERE deleted_at IS NULL";
  if (input.barcode) {
    sql += " AND barcode = ?";
    binds.push(input.barcode);
  }
  if (input.kind) sql += input.kind === "recipe" ? " AND recipe_servings IS NOT NULL" : " AND recipe_servings IS NULL";
  for (const word of words) {
    sql += " AND (name_key || ' ' || brand_key) LIKE ? ESCAPE '\\'";
    binds.push(`%${escapeLike(word)}%`);
  }
  // Exact and prefix name matches first, then the foods logged most.
  const phrase = words.join(" ");
  sql += " ORDER BY (name_key = ?) DESC, (name_key LIKE ? ESCAPE '\\') DESC, log_count DESC, last_logged_at DESC, name_key LIMIT ?";
  binds.push(phrase, `${escapeLike(phrase)}%`, input.limit ?? 10);
  const result = await ctx.env.DB.prepare(sql).bind(...binds).all<FoodRow>();
  return { foods: result.results.map(foodOut) };
}

export async function saveFood(ctx: Ctx, input: z.infer<typeof saveFoodSchema>) {
  const db = ctx.env.DB;
  const now = ctx.now.toISOString();
  const keys = { name_key: nameKey(input.name), brand_key: nameKey(input.brand ?? "") };
  const existing = input.id
    ? await loadFood(ctx.env, input.id)
    : await db.prepare("SELECT * FROM foods WHERE name_key = ? AND brand_key = ? AND deleted_at IS NULL").bind(keys.name_key, keys.brand_key).first<FoodRow>();
  // A recipe's nutrients come from its ingredients, so only save_recipe changes them.
  if (existing?.recipe_servings != null) {
    throw new PantryError("conflict", `"${existing.name}" is a recipe. Change it with save_recipe, or choose another name.`);
  }

  // A field that is not sent keeps its saved value. null clears an optional field.
  const pick = <K extends keyof FoodRow>(field: K, sent: FoodRow[K] | undefined, fallback: FoodRow[K]): FoodRow[K] =>
    sent !== undefined ? sent : existing ? existing[field] : fallback;
  const values = {
    name: input.name,
    brand: input.brand === undefined && existing ? existing.brand : input.brand || null,
    ...keys,
    serving_size: pick("serving_size", input.serving_size, 1),
    serving_unit: pick("serving_unit", input.serving_unit, "serving"),
    serving_grams: pick("serving_grams", input.serving_grams, null),
    calories: input.calories,
    protein_g: input.protein_g,
    carbs_g: input.carbs_g,
    fat_g: input.fat_g,
    fiber_g: pick("fiber_g", input.fiber_g, null),
    sugar_g: pick("sugar_g", input.sugar_g, null),
    sodium_mg: pick("sodium_mg", input.sodium_mg, null),
    barcode: pick("barcode", input.barcode, null),
    notes: pick("notes", input.notes, null),
  };
  if (existing && input.brand === undefined) values.brand_key = existing.brand_key;
  const columns = Object.keys(values) as (keyof typeof values)[];

  try {
    if (existing) {
      const row = await db
        .prepare(`UPDATE foods SET ${columns.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ? RETURNING *`)
        .bind(...columns.map((c) => values[c]), now, existing.id)
        .first<FoodRow>();
      return { food: foodOut(row!), created: false };
    }
    const row = await db
      .prepare(
        `INSERT INTO foods (id, ${columns.join(", ")}, created_by, created_at, updated_at)
         VALUES (?, ${columns.map(() => "?").join(", ")}, ?, ?, ?) RETURNING *`,
      )
      .bind(ulid(ctx.now.getTime()), ...columns.map((c) => values[c]), ctx.access.agentId, now, now)
      .first<FoodRow>();
    return { food: foodOut(row!), created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new PantryError("conflict", `Another saved food is already named "${input.name}"${input.brand ? ` by ${input.brand}` : ""}. Update that one instead.`);
    }
    throw err;
  }
}

export async function deleteFood(ctx: Ctx, input: z.infer<typeof idSchema>) {
  const result = await ctx.env.DB.prepare("UPDATE foods SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL").bind(ctx.now.toISOString(), ctx.access.agentId, input.id).run();
  if (!result.meta.changes) throw new PantryError("not_found", `No saved food with id ${input.id}`);
  return { id: input.id, deleted: true };
}

type Source = {
  food_id: string | null;
  name: string;
  brand: string | null;
  serving_size: number | null;
  serving_unit: string | null;
  serving_grams: number | null;
  perServing: Nutrients;
};

function servingsFor(servings: number | undefined, grams: number | undefined, servingGrams: number | null): number {
  if (servings !== undefined && grams !== undefined) throw new PantryError("invalid", "Send servings or grams, not both");
  if (grams === undefined) return servings ?? 1;
  if (!servingGrams) throw new PantryError("invalid", "grams needs a serving_grams on the food. Send servings instead, or save serving_grams first.");
  return grams / servingGrams;
}

type SourceInput = Pick<z.infer<typeof logFoodSchema>, "food_id" | "name" | "brand" | "serving_size" | "serving_unit" | "serving_grams" | "save_food" | Nutrient>;

// A saved food by food_id, or a name with per-serving nutrients. Shared by log_food and recipe ingredients.
async function resolveSource(ctx: Ctx, input: SourceInput): Promise<Source> {
  const sentNutrients = NUTRIENTS.filter((n) => input[n] !== undefined);
  let source: Source;
  if (input.food_id) {
    if (input.name || sentNutrients.length || input.save_food) {
      throw new PantryError("invalid", "Send food_id for a saved food, or name with nutrients for a new one, not both");
    }
    const food = await loadFood(ctx.env, input.food_id);
    source = { ...food, food_id: food.id, perServing: nutrientsOf(food) };
  } else {
    if (!input.name) throw new PantryError("invalid", "Send food_id, or name with calories, protein_g, carbs_g, and fat_g per serving");
    const missing = CORE.filter((n) => input[n] === undefined);
    if (missing.length) throw new PantryError("invalid", `A food that is not saved needs ${missing.join(", ")} per serving. Estimate them if no label is at hand.`);
    if (input.save_food) {
      const { food } = await saveFood(ctx, {
        name: input.name,
        brand: input.brand,
        serving_size: input.serving_size,
        serving_unit: input.serving_unit,
        serving_grams: input.serving_grams,
        calories: input.calories!,
        protein_g: input.protein_g!,
        carbs_g: input.carbs_g!,
        fat_g: input.fat_g!,
        fiber_g: input.fiber_g,
        sugar_g: input.sugar_g,
        sodium_mg: input.sodium_mg,
      });
      source = { ...food, food_id: food.id, perServing: food.per_serving };
    } else {
      source = {
        food_id: null,
        name: input.name,
        brand: input.brand ?? null,
        serving_size: input.serving_size ?? 1,
        serving_unit: input.serving_unit ?? "serving",
        serving_grams: input.serving_grams ?? null,
        perServing: nutrientsOf(input),
      };
    }
  }
  return source;
}

export async function logFood(ctx: Ctx, input: z.infer<typeof logFoodSchema>) {
  const db = ctx.env.DB;
  const replay = async () => {
    if (!input.idempotency_key) return null;
    const row = await db.prepare("SELECT * FROM entries WHERE agent_id = ? AND idempotency_key = ?").bind(ctx.access.agentId, input.idempotency_key).first<EntryRow>();
    return row ? { entry: entryOut(row), replayed: true, day: await dayTotals(ctx.env, row.local_date) } : null;
  };
  const earlier = await replay();
  if (earlier) return earlier;

  const source = await resolveSource(ctx, input);
  const servings = servingsFor(input.servings, input.grams, source.serving_grams);
  const consumedAt = input.consumed_at ? parseInstant(input.consumed_at, "consumed_at") : input.date ? null : ctx.now;
  const date = input.date !== undefined ? resolveDate(ctx, input.date) : localDate(consumedAt!, ctx.zone);
  const meal = input.meal ?? mealFor(consumedAt ? localHour(consumedAt, ctx.zone) : null);
  const now = ctx.now.toISOString();
  const id = ulid(ctx.now.getTime());

  const statements = [
    db
      .prepare(
        `INSERT INTO entries (id, local_date, consumed_at, meal, food_id, name, brand, servings, serving_size, serving_unit, serving_grams,
           ${NUTRIENTS.join(", ")}, note, agent_id, idempotency_key, created_at, updated_at)
         VALUES (${Array(11 + NUTRIENTS.length + 5).fill("?").join(", ")})`,
      )
      .bind(
        id, date, consumedAt?.toISOString() ?? null, meal, source.food_id, source.name, source.brand, servings,
        source.serving_size, source.serving_unit, source.serving_grams,
        ...NUTRIENTS.map((n) => source.perServing[n]),
        input.note ?? null, ctx.access.agentId, input.idempotency_key ?? null, now, now,
      ),
  ];
  if (source.food_id) {
    statements.push(db.prepare("UPDATE foods SET log_count = log_count + 1, last_logged_at = ? WHERE id = ?").bind(now, source.food_id));
  }
  try {
    await db.batch(statements);
  } catch (err) {
    // Two retries with one key raced. The first one won; answer with its entry.
    if (isUniqueViolation(err)) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw err;
  }
  return { entry: entryOut(await loadEntry(ctx.env, id)), replayed: false, day: await dayTotals(ctx.env, date) };
}

export async function updateEntry(ctx: Ctx, input: z.infer<typeof updateEntrySchema>) {
  const entry = await loadEntry(ctx.env, input.id);
  const servings = input.servings === undefined && input.grams === undefined ? entry.servings : servingsFor(input.servings, input.grams, entry.serving_grams);
  let consumedAt = entry.consumed_at;
  if (input.consumed_at !== undefined) consumedAt = input.consumed_at === null ? null : parseInstant(input.consumed_at, "consumed_at").toISOString();
  let date = entry.local_date;
  if (input.date !== undefined) date = resolveDate(ctx, input.date);
  else if (input.consumed_at) date = localDate(new Date(consumedAt!), ctx.zone);
  const meal = input.meal ?? entry.meal;
  const note = input.note !== undefined ? input.note : entry.note;

  await ctx.env.DB.prepare("UPDATE entries SET servings = ?, consumed_at = ?, local_date = ?, meal = ?, note = ?, updated_at = ? WHERE id = ?")
    .bind(servings, consumedAt, date, meal, note, ctx.now.toISOString(), entry.id)
    .run();
  return { entry: entryOut(await loadEntry(ctx.env, entry.id)), day: await dayTotals(ctx.env, date) };
}

export async function deleteEntry(ctx: Ctx, input: z.infer<typeof idSchema>) {
  const entry = await loadEntry(ctx.env, input.id);
  await ctx.env.DB.prepare("UPDATE entries SET deleted_at = ?, deleted_by = ? WHERE id = ?").bind(ctx.now.toISOString(), ctx.access.agentId, entry.id).run();
  return { id: entry.id, deleted: true, day: await dayTotals(ctx.env, entry.local_date) };
}

export async function getDay(ctx: Ctx, input: z.infer<typeof dateSchema>) {
  const date = resolveDate(ctx, input.date);
  const [entries, goal] = await Promise.all([entriesFor(ctx.env, date), goalsFor(ctx.env, date)]);
  const meals = MEALS.map((meal) => {
    const items = entries.filter((e) => e.meal === meal);
    return { meal, totals: rounded(sum(items.map((e) => scaled(nutrientsOf(e), e.servings)))), entries: items.map(entryOut) };
  }).filter((m) => m.entries.length);
  const totals = sum(entries.map((e) => scaled(nutrientsOf(e), e.servings)));
  const goals = goal ? nutrientsOf(goal) : null;
  return {
    date,
    time_zone: ctx.zone,
    entry_count: entries.length,
    totals: rounded(totals),
    goals,
    remaining: remaining(goals, totals),
    meals,
  };
}

export async function getTrends(ctx: Ctx, input: z.infer<typeof rangeSchema>) {
  const { from, to } = resolveRange(ctx, input, 7);
  const rows = await ctx.env.DB.prepare(
    `SELECT local_date, COUNT(*) AS entry_count, ${NUTRIENTS.map((n) => `SUM(${n} * servings) AS ${n}`).join(", ")}
     FROM entries WHERE deleted_at IS NULL AND local_date BETWEEN ? AND ? GROUP BY local_date`,
  )
    .bind(from, to)
    .all<{ local_date: string; entry_count: number } & Nutrients>();
  const byDate = new Map(rows.results.map((r) => [r.local_date, r]));
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const row = byDate.get(date);
    days.push({ date, entry_count: row?.entry_count ?? 0, totals: row ? rounded(nutrientsOf(row)) : null });
  }
  const logged = rows.results.map((r) => nutrientsOf(r));
  const totals = sum(logged);
  const average = rounded(Object.fromEntries(NUTRIENTS.map((n) => [n, totals[n] === null || !logged.length ? null : totals[n]! / logged.length])) as Nutrients);
  const goalRows = await ctx.env.DB.prepare("SELECT * FROM goals WHERE effective_from <= ? ORDER BY effective_from").bind(to).all<GoalRow>();
  const goalOn = (date: string) => [...goalRows.results].reverse().find((g) => g.effective_from <= date) ?? null;
  const goal = goalOn(to);
  const goals = goal ? nutrientsOf(goal) : null;
  // Each logged day is compared with the goals in force on that day, so a goal change inside the
  // range does not move the earlier days.
  const averageVsGoal: Partial<Record<Nutrient, number>> = {};
  for (const n of NUTRIENTS) {
    const gaps = rows.results.flatMap((r) => {
      const dayGoal = goalOn(r.local_date)?.[n];
      return dayGoal === null || dayGoal === undefined || r[n] === null ? [] : [r[n]! - dayGoal];
    });
    if (gaps.length) averageVsGoal[n] = round(gaps.reduce((a, b) => a + b, 0) / gaps.length)!;
  }
  return {
    from,
    to,
    total_days: days.length,
    logged_days: logged.length,
    average_per_logged_day: logged.length ? average : null,
    goals,
    average_vs_goal: averageVsGoal,
    days,
  };
}

export async function getGoals(ctx: Ctx, input: z.infer<typeof dateSchema>) {
  const date = resolveDate(ctx, input.date);
  const goal = await goalsFor(ctx.env, date);
  return { date, effective_from: goal?.effective_from ?? null, goals: goal ? nutrientsOf(goal) : null };
}

export async function setGoals(ctx: Ctx, input: z.infer<typeof setGoalsSchema>) {
  const effective = resolveDate(ctx, input.effective_from, "effective_from");
  const current = await goalsFor(ctx.env, effective);
  const goals = Object.fromEntries(
    NUTRIENTS.map((n) => [n, input[n] !== undefined ? input[n] : input.replace ? null : (current?.[n] ?? null)]),
  ) as Nutrients;
  await ctx.env.DB.prepare(
    `INSERT INTO goals (effective_from, ${NUTRIENTS.join(", ")}, set_by, created_at) VALUES (?, ${NUTRIENTS.map(() => "?").join(", ")}, ?, ?)
     ON CONFLICT (effective_from) DO UPDATE SET ${NUTRIENTS.map((n) => `${n} = excluded.${n}`).join(", ")}, set_by = excluded.set_by, created_at = excluded.created_at`,
  )
    .bind(effective, ...NUTRIENTS.map((n) => goals[n]), ctx.access.agentId, ctx.now.toISOString())
    .run();
  const later = await ctx.env.DB.prepare("SELECT effective_from FROM goals WHERE effective_from > ? ORDER BY effective_from LIMIT 1").bind(effective).first<{ effective_from: string }>();
  return { effective_from: effective, goals, ...(later ? { superseded_from: later.effective_from } : {}) };
}

export async function logWeight(ctx: Ctx, input: z.infer<typeof logWeightSchema>) {
  const db = ctx.env.DB;
  const replay = async () => {
    if (!input.idempotency_key) return null;
    const row = await db.prepare("SELECT * FROM weights WHERE agent_id = ? AND idempotency_key = ?").bind(ctx.access.agentId, input.idempotency_key).first<WeightRow>();
    return row ? { weight: weightOut(row), replayed: true } : null;
  };
  const earlier = await replay();
  if (earlier) return earlier;

  const measuredAt = input.measured_at ? parseInstant(input.measured_at, "measured_at") : input.date ? null : ctx.now;
  const date = input.date !== undefined ? resolveDate(ctx, input.date) : localDate(measuredAt!, ctx.zone);
  const kg = input.unit === "lb" ? input.weight / LB_PER_KG : input.weight;
  const id = ulid(ctx.now.getTime());
  try {
    await db
      .prepare(
        `INSERT INTO weights (id, local_date, measured_at, weight_kg, body_fat_pct, note, agent_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, date, measuredAt?.toISOString() ?? null, kg, input.body_fat_pct ?? null, input.note ?? null, ctx.access.agentId, input.idempotency_key ?? null, ctx.now.toISOString())
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw err;
  }
  const previous = await db
    .prepare("SELECT * FROM weights WHERE deleted_at IS NULL AND id != ? AND local_date <= ? ORDER BY local_date DESC, COALESCE(measured_at, created_at) DESC LIMIT 1")
    .bind(id, date)
    .first<WeightRow>();
  const row = await db.prepare("SELECT * FROM weights WHERE id = ?").bind(id).first<WeightRow>();
  return {
    weight: weightOut(row!),
    replayed: false,
    previous: previous ? weightOut(previous) : null,
    change_kg: previous ? round(kg - previous.weight_kg, 2) : null,
  };
}

export async function getWeights(ctx: Ctx, input: z.infer<typeof rangeSchema>) {
  const { from, to } = resolveRange(ctx, input, 30);
  const result = await ctx.env.DB.prepare(
    "SELECT * FROM weights WHERE deleted_at IS NULL AND local_date BETWEEN ? AND ? ORDER BY local_date, COALESCE(measured_at, created_at), id",
  )
    .bind(from, to)
    .all<WeightRow>();
  const rows = result.results;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const kgs = rows.map((r) => r.weight_kg);
  return {
    from,
    to,
    count: rows.length,
    first: first ? weightOut(first) : null,
    last: last ? weightOut(last) : null,
    change_kg: first && last ? round(last.weight_kg - first.weight_kg, 2) : null,
    change_lb: first && last ? round((last.weight_kg - first.weight_kg) * LB_PER_KG, 1) : null,
    min_kg: kgs.length ? round(Math.min(...kgs), 2) : null,
    max_kg: kgs.length ? round(Math.max(...kgs), 2) : null,
    weights: rows.map(weightOut),
  };
}

export async function deleteWeight(ctx: Ctx, input: z.infer<typeof idSchema>) {
  const result = await ctx.env.DB.prepare("UPDATE weights SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL").bind(ctx.now.toISOString(), ctx.access.agentId, input.id).run();
  if (!result.meta.changes) throw new PantryError("not_found", `No weight with id ${input.id}`);
  return { id: input.id, deleted: true };
}

// ---------- recipes ----------

type Ingredient = { source: Source; servings: number; note: string | null };

const OPTIONAL: Nutrient[] = NUTRIENTS.filter((n) => !CORE.includes(n));

function ingredientGrams(servings: number, servingGrams: number | null): number | null {
  return servingGrams === null ? null : servings * servingGrams;
}

// A nutrient is incomplete when some ingredients report it and others do not, so the sum is too low.
function incompleteNutrients(items: Nutrients[]): Nutrient[] {
  return OPTIONAL.filter((n) => items.some((i) => i[n] === null) && items.some((i) => i[n] !== null));
}

async function loadIngredients(env: Env, recipeId: string): Promise<IngredientRow[]> {
  const result = await env.DB.prepare("SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position").bind(recipeId).all<IngredientRow>();
  return result.results;
}

async function loadRecipe(env: Env, id: string): Promise<FoodRow> {
  const food = await loadFood(env, id);
  if (food.recipe_servings === null) throw new PantryError("not_found", `${food.name} (${id}) is a plain food, not a recipe`);
  return food;
}

async function recipeOut(env: Env, food: FoodRow) {
  const servings = food.recipe_servings!;
  const totalGrams = food.recipe_total_grams;
  const rows = await loadIngredients(env, food.id);
  const ingredients = rows.map((row) => ({ row, totals: scaled(nutrientsOf(row), row.servings), grams: ingredientGrams(row.servings, row.serving_grams) }));
  const batchTotals = sum(ingredients.map((i) => i.totals));
  const rawGrams = ingredients.every((i) => i.grams !== null) ? ingredients.reduce((a, i) => a + i.grams!, 0) : null;

  // What was logged from the current batch: entries of this recipe made since the batch started.
  const eaten = await env.DB.prepare(
    "SELECT COUNT(*) AS entry_count, SUM(servings) AS servings, SUM(servings * serving_grams) AS grams FROM entries WHERE food_id = ? AND deleted_at IS NULL AND created_at >= ?",
  )
    .bind(food.id, food.recipe_batch_at ?? "")
    .first<{ entry_count: number; servings: number | null; grams: number | null }>();
  const eatenGrams = totalGrams === null ? null : (eaten?.grams ?? 0);
  const eatenServings = totalGrams === null ? (eaten?.servings ?? 0) : eatenGrams! / food.serving_grams!;

  return {
    id: food.id,
    name: food.name,
    servings,
    serving_unit: food.serving_unit,
    total_grams: totalGrams === null ? null : round(totalGrams),
    serving_grams: food.serving_grams === null ? null : round(food.serving_grams),
    raw_grams: rawGrams === null ? null : round(rawGrams),
    per_serving: rounded(nutrientsOf(food)),
    per_100g: totalGrams ? rounded(scaled(batchTotals, 100 / totalGrams)) : null,
    batch_totals: rounded(batchTotals),
    incomplete_nutrients: incompleteNutrients(rows.map((r) => nutrientsOf(r))),
    ingredients: ingredients.map(({ row, totals, grams }) => ({
      position: row.position,
      food_id: row.food_id,
      name: row.name,
      brand: row.brand,
      servings: round(row.servings, 3),
      grams: grams === null ? null : round(grams),
      serving_size: row.serving_size,
      serving_unit: row.serving_unit,
      totals: rounded(totals),
      note: row.note,
    })),
    batch: {
      started_at: food.recipe_batch_at,
      entry_count: eaten?.entry_count ?? 0,
      eaten_grams: eatenGrams === null ? null : round(eatenGrams),
      left_grams: eatenGrams === null ? null : round(Math.max(0, totalGrams! - eatenGrams)),
      left_servings: round(Math.max(0, servings - eatenServings), 2),
    },
    notes: food.notes,
    log_count: food.log_count,
    updated_at: food.updated_at,
  };
}

export async function getRecipe(ctx: Ctx, input: z.infer<typeof idSchema>) {
  return { recipe: await recipeOut(ctx.env, await loadRecipe(ctx.env, input.id)) };
}

export async function saveRecipe(ctx: Ctx, input: z.infer<typeof saveRecipeSchema>) {
  const db = ctx.env.DB;
  const now = ctx.now.toISOString();
  const key = nameKey(input.name);
  let existing: FoodRow | null;
  if (input.id) {
    existing = await loadRecipe(ctx.env, input.id);
  } else {
    existing = await db.prepare("SELECT * FROM foods WHERE name_key = ? AND brand_key = '' AND deleted_at IS NULL").bind(key).first<FoodRow>();
    if (existing && existing.recipe_servings === null) {
      throw new PantryError("conflict", `A plain food is already named "${existing.name}". Choose another name for the recipe, or delete that food first.`);
    }
  }
  if (!existing && !input.ingredients) throw new PantryError("invalid", "A new recipe needs ingredients");

  // Resolve every ingredient to a per-serving snapshot and an amount, as log_food does. The first
  // pass only checks, so a bad ingredient fails the call before save_food writes any of the others.
  let ingredients: Ingredient[];
  if (input.ingredients) {
    ingredients = [];
    for (const save of [false, true]) {
      for (const [index, item] of input.ingredients.entries()) {
        if (save && !item.save_food) continue;
        try {
          if (existing && item.food_id === existing.id) throw new PantryError("invalid", "A recipe cannot contain itself");
          const source = await resolveSource(ctx, save ? item : { ...item, save_food: false });
          ingredients[index] = { source, servings: servingsFor(item.servings, item.grams, source.serving_grams), note: item.note ?? null };
        } catch (err) {
          if (err instanceof PantryError) throw new PantryError(err.code, `ingredients[${index}]${item.name ? ` (${item.name})` : ""}: ${err.message}`);
          throw err;
        }
      }
    }
  } else {
    ingredients = (await loadIngredients(ctx.env, existing!.id)).map((row) => ({ source: { ...row, perServing: nutrientsOf(row) }, servings: row.servings, note: row.note }));
  }

  const totals = ingredients.map((i) => scaled(i.source.perServing, i.servings));
  const batchTotals = sum(totals);
  const grams = ingredients.map((i) => ingredientGrams(i.servings, i.source.serving_grams));
  const rawGrams = grams.every((g) => g !== null) ? grams.reduce((a, g) => a + g!, 0) : null;

  const warnings: string[] = [];
  let totalGrams: number | null;
  if (input.total_grams !== undefined) totalGrams = input.total_grams;
  else if (existing?.recipe_total_grams != null) {
    totalGrams = existing.recipe_total_grams;
    if (input.ingredients) warnings.push(`total_grams stays at the saved ${round(totalGrams)} g. If this batch weighs something else, send total_grams.`);
  } else {
    totalGrams = rawGrams;
    if (rawGrams !== null) warnings.push(`total_grams is the raw weight of the ingredients (${round(rawGrams)} g). Cooking usually changes the weight; weigh the finished batch and send total_grams.`);
  }
  if (totalGrams === null) warnings.push("The weight of the batch is not known, so it cannot be logged by grams. Send total_grams, or log it by servings.");
  if (totalGrams !== null && rawGrams !== null && (totalGrams < rawGrams * 0.3 || totalGrams > rawGrams * 3)) {
    warnings.push(`total_grams (${round(totalGrams)} g) is far from the raw weight of the ingredients (${round(rawGrams)} g). Make sure it is the weight of the food only, without the pot.`);
  }
  for (const n of incompleteNutrients(ingredients.map((i) => i.source.perServing))) {
    warnings.push(`${n} is known for only some ingredients, so the recipe value is too low.`);
  }

  const servings = input.servings ?? existing?.recipe_servings ?? 1;
  const savedUnit = existing && existing.serving_unit !== "batch" && existing.serving_unit !== "serving" ? existing.serving_unit : null;
  // Sending ingredients or a weight means a new batch was cooked, so the leftover count starts again.
  const newBatch = !existing || input.ingredients !== undefined || input.total_grams !== undefined;
  const values = {
    name: input.name,
    name_key: key,
    serving_size: 1,
    serving_unit: input.serving_unit ?? savedUnit ?? (servings === 1 ? "batch" : "serving"),
    serving_grams: totalGrams === null ? null : totalGrams / servings,
    ...scaled(batchTotals, 1 / servings),
    notes: input.notes !== undefined ? input.notes : (existing?.notes ?? null),
    recipe_servings: servings,
    recipe_total_grams: totalGrams,
    recipe_batch_at: newBatch ? now : existing!.recipe_batch_at,
  };
  const columns = Object.keys(values) as (keyof typeof values)[];
  const id = existing?.id ?? ulid(ctx.now.getTime());

  const statements = [
    existing
      ? db.prepare(`UPDATE foods SET ${columns.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).bind(...columns.map((c) => values[c]), now, id)
      : db
          .prepare(`INSERT INTO foods (id, brand_key, ${columns.join(", ")}, created_by, created_at, updated_at) VALUES (?, '', ${columns.map(() => "?").join(", ")}, ?, ?, ?)`)
          .bind(id, ...columns.map((c) => values[c]), ctx.access.agentId, now, now),
  ];
  if (input.ingredients) {
    statements.push(db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(id));
    ingredients.forEach(({ source, servings: amount, note }, position) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO recipe_ingredients (id, recipe_id, position, food_id, name, brand, servings, serving_size, serving_unit, serving_grams,
               ${NUTRIENTS.join(", ")}, note, created_at)
             VALUES (${Array(10 + NUTRIENTS.length + 2).fill("?").join(", ")})`,
          )
          .bind(
            ulid(ctx.now.getTime()), id, position, source.food_id, source.name, source.brand, amount,
            source.serving_size, source.serving_unit, source.serving_grams,
            ...NUTRIENTS.map((n) => source.perServing[n]),
            note, now,
          ),
      );
    });
  }
  try {
    await db.batch(statements);
  } catch (err) {
    if (isUniqueViolation(err)) throw new PantryError("conflict", `Another saved food or recipe is already named "${input.name}". Update that one instead.`);
    throw err;
  }
  return { recipe: await recipeOut(ctx.env, await loadFood(ctx.env, id)), created: !existing, warnings };
}
