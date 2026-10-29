import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN, call, data, mint, reset, rest } from "./helpers";

let agent: string;
beforeEach(async () => {
  await reset();
  agent = await mint("claude");
});

const oats = { name: "Rolled oats", brand: "Acme", serving_size: 40, serving_unit: "g", serving_grams: 40, calories: 150, protein_g: 5, carbs_g: 27, fat_g: 3, fiber_g: 4 };

describe("foods", () => {
  it("saves, updates by name and brand, searches, and deletes", async () => {
    const first = await data(agent, "save_food", oats);
    expect(first.created).toBe(true);
    const again = await data(agent, "save_food", { ...oats, name: "rolled  OATS", calories: 152 });
    expect(again.created).toBe(false);
    expect(again.food.id).toBe(first.food.id);
    expect(again.food.per_serving.calories).toBe(152);
    // A field not sent keeps its saved value.
    expect(again.food.per_serving.fiber_g).toBe(4);

    await data(agent, "save_food", { name: "Oat milk", calories: 120, protein_g: 3, carbs_g: 16, fat_g: 5 });
    const found = await data(agent, "search_foods", { query: "oats acme" });
    expect(found.foods.map((f: any) => f.id)).toEqual([first.food.id]);
    expect((await data(agent, "search_foods", { query: "oat" })).foods).toHaveLength(2);
    expect((await data(agent, "search_foods", { query: "50%_" })).foods).toHaveLength(0);

    await data(agent, "delete_food", { id: first.food.id });
    expect((await data(agent, "search_foods", { query: "rolled" })).foods).toHaveLength(0);
    expect((await call(agent, "delete_food", { id: first.food.id })).status).toBe(404);
  });

  it("refuses a rename onto another saved food", async () => {
    await data(agent, "save_food", { name: "A", calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0 });
    const b = await data(agent, "save_food", { name: "B", calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0 });
    const clash = await call(agent, "save_food", { id: b.food.id, name: "a", calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(clash.status).toBe(409);
  });
});

describe("log_food", () => {
  it("logs a saved food by grams and returns the day's totals", async () => {
    const { food } = await data(agent, "save_food", oats);
    const logged = await data(agent, "log_food", { food_id: food.id, grams: 60, meal: "breakfast", date: "2026-10-20" });
    expect(logged.entry.servings).toBe(1.5);
    expect(logged.entry.totals).toMatchObject({ calories: 225, protein_g: 7.5, fiber_g: 6 });
    expect(logged.day).toMatchObject({ date: "2026-10-20", entry_count: 1, totals: { calories: 225 } });
    expect((await data(agent, "search_foods", {})).foods[0]).toMatchObject({ id: food.id, log_count: 1 });
  });

  it("logs an ad hoc food and can save it", async () => {
    const logged = await data(agent, "log_food", { name: "Banana", calories: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4, servings: 2, save_food: true, date: "2026-10-20" });
    expect(logged.entry.totals.calories).toBe(210);
    expect(logged.entry.food_id).toBeTruthy();
    expect((await data(agent, "search_foods", { query: "banana" })).foods).toHaveLength(1);
  });

  it("validates the food source and quantity", async () => {
    const missing = await call(agent, "log_food", { name: "Mystery", calories: 100 });
    expect(missing.status).toBe(400);
    expect(missing.json.error?.message).toContain("protein_g");
    expect((await call(agent, "log_food", {})).status).toBe(400);
    expect((await call(agent, "log_food", { name: "X", calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0, grams: 10 })).status).toBe(400);
    expect((await call(agent, "log_food", { food_id: "nope" })).status).toBe(404);
    expect((await call(agent, "log_food", { name: "X", calories: -1, protein_g: 0, carbs_g: 0, fat_g: 0 })).status).toBe(400);
    expect((await call(agent, "log_food", { name: "X", calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0, date: "2026-02-30" })).status).toBe(400);
  });

  it("files consumed_at on the day and meal of the pantry time zone", async () => {
    // 01:30 UTC on the 27th is 21:30 on the 26th in New York.
    const late = await data(agent, "log_food", { name: "Popcorn", calories: 100, protein_g: 3, carbs_g: 20, fat_g: 1, consumed_at: "2026-10-27T01:30:00Z" });
    expect(late.entry).toMatchObject({ date: "2026-10-26", meal: "dinner" });
    const morning = await data(agent, "log_food", { name: "Toast", calories: 80, protein_g: 3, carbs_g: 15, fat_g: 1, consumed_at: "2026-10-27T12:00:00Z" });
    expect(morning.entry).toMatchObject({ date: "2026-10-27", meal: "breakfast" });
    const undated = await data(agent, "log_food", { name: "Soup", calories: 80, protein_g: 3, carbs_g: 15, fat_g: 1, date: "2026-10-01" });
    expect(undated.entry).toMatchObject({ consumed_at: null, meal: "other" });
  });

  it("replays a retry with the same idempotency key", async () => {
    const args = { name: "Egg", calories: 70, protein_g: 6, carbs_g: 0.5, fat_g: 5, date: "2026-10-20", idempotency_key: "egg-1" };
    const first = await data(agent, "log_food", args);
    const second = await data(agent, "log_food", args);
    expect(second.replayed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(second.day.entry_count).toBe(1);
  });

  it("keeps the logged nutrients when the saved food changes", async () => {
    const { food } = await data(agent, "save_food", oats);
    await data(agent, "log_food", { food_id: food.id, date: "2026-10-20" });
    await data(agent, "save_food", { ...oats, calories: 999 });
    expect((await data(agent, "get_day", { date: "2026-10-20" })).totals.calories).toBe(150);
  });

  it("updates and deletes entries", async () => {
    const { entry } = await data(agent, "log_food", { name: "Rice", serving_grams: 100, calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3, date: "2026-10-20" });
    const updated = await data(agent, "update_entry", { id: entry.id, grams: 250, meal: "dinner", date: "2026-10-21" });
    expect(updated.entry).toMatchObject({ servings: 2.5, meal: "dinner", date: "2026-10-21" });
    expect(updated.day).toMatchObject({ date: "2026-10-21", totals: { calories: 325 } });
    const removed = await data(agent, "delete_entry", { id: entry.id });
    expect(removed.day.entry_count).toBe(0);
    const row = await (env as Env).DB.prepare("SELECT deleted_by FROM entries WHERE id = ?").bind(entry.id).first<{ deleted_by: string }>();
    expect(row?.deleted_by).toBe("claude");
    expect((await call(agent, "delete_entry", { id: entry.id })).status).toBe(404);
  });
});

describe("days, goals, and trends", () => {
  it("groups a day by meal and subtracts goals", async () => {
    await data(agent, "set_goals", { calories: 2000, protein_g: 150, effective_from: "2026-10-01" });
    await data(agent, "log_food", { name: "Eggs", calories: 210, protein_g: 18, carbs_g: 1, fat_g: 15, meal: "breakfast", date: "2026-10-20" });
    await data(agent, "log_food", { name: "Chicken", calories: 300, protein_g: 50, carbs_g: 0, fat_g: 8, meal: "dinner", date: "2026-10-20" });
    const day = await data(agent, "get_day", { date: "2026-10-20" });
    expect(day.meals.map((m: any) => m.meal)).toEqual(["breakfast", "dinner"]);
    expect(day.totals).toMatchObject({ calories: 510, protein_g: 68, fiber_g: null });
    expect(day.remaining).toEqual({ calories: 1490, protein_g: 82 });
  });

  it("merges goals unless replace is set, and applies them by day", async () => {
    await data(agent, "set_goals", { calories: 2000, protein_g: 150, effective_from: "2026-10-01" });
    const merged = await data(agent, "set_goals", { protein_g: 160, effective_from: "2026-10-15" });
    expect(merged.goals).toMatchObject({ calories: 2000, protein_g: 160 });
    expect((await data(agent, "get_goals", { date: "2026-10-10" })).goals.protein_g).toBe(150);
    expect((await data(agent, "get_goals", { date: "2026-10-20" })).effective_from).toBe("2026-10-15");
    const replaced = await data(agent, "set_goals", { fat_g: 70, replace: true, effective_from: "2026-10-15" });
    expect(replaced.goals).toMatchObject({ calories: null, protein_g: null, fat_g: 70 });
    expect((await data(agent, "get_goals", { date: "2026-09-01" })).goals).toBeNull();
  });

  it("averages logged days over a range", async () => {
    await data(agent, "set_goals", { calories: 2000, effective_from: "2026-10-01" });
    await data(agent, "log_food", { name: "A", calories: 1800, protein_g: 100, carbs_g: 200, fat_g: 60, date: "2026-10-18" });
    await data(agent, "log_food", { name: "B", calories: 2200, protein_g: 120, carbs_g: 250, fat_g: 70, date: "2026-10-20" });
    const trends = await data(agent, "get_trends", { from: "2026-10-14", to: "2026-10-20" });
    expect(trends).toMatchObject({ total_days: 7, logged_days: 2, average_per_logged_day: { calories: 2000, protein_g: 110 }, average_vs_goal: { calories: 0 } });
    expect(trends.days[0]).toEqual({ date: "2026-10-14", entry_count: 0, totals: null });
    expect((await data(agent, "get_trends", { to: "2026-10-20", days: 3 })).from).toBe("2026-10-18");
    expect((await call(agent, "get_trends", { from: "2026-10-21", to: "2026-10-20" })).status).toBe(400);
  });

  it("compares each day of a range with the goals of that day", async () => {
    await data(agent, "set_goals", { calories: 2000, effective_from: "2026-10-01" });
    await data(agent, "set_goals", { calories: 1500, effective_from: "2026-10-19" });
    await data(agent, "log_food", { name: "A", calories: 2100, protein_g: 100, carbs_g: 200, fat_g: 60, date: "2026-10-18" });
    await data(agent, "log_food", { name: "B", calories: 1600, protein_g: 120, carbs_g: 250, fat_g: 70, date: "2026-10-20" });
    const trends = await data(agent, "get_trends", { from: "2026-10-14", to: "2026-10-20" });
    expect(trends.goals.calories).toBe(1500);
    expect(trends.average_vs_goal).toEqual({ calories: 100 });
  });
});

describe("weights", () => {
  it("logs weights in lb or kg and reports change", async () => {
    await data(agent, "log_weight", { weight: 80, unit: "kg", date: "2026-10-01" });
    const second = await data(agent, "log_weight", { weight: 174, unit: "lb", date: "2026-10-15", idempotency_key: "w2" });
    expect(second.weight.weight_kg).toBeCloseTo(78.93, 2);
    expect(second.change_kg).toBeCloseTo(-1.07, 2);
    expect((await data(agent, "log_weight", { weight: 174, unit: "lb", date: "2026-10-15", idempotency_key: "w2" })).replayed).toBe(true);
    const range = await data(agent, "get_weights", { from: "2026-10-01", to: "2026-10-31" });
    expect(range).toMatchObject({ count: 2, change_kg: -1.07 });
    await data(agent, "delete_weight", { id: second.weight.id });
    expect((await data(agent, "get_weights", { from: "2026-10-01", to: "2026-10-31" })).count).toBe(1);
  });

  it("lets the admin token use every tool from the console", async () => {
    expect((await rest("/console/api/tools/log_weight", ADMIN, { method: "POST", body: JSON.stringify({ weight: 70, unit: "kg" }) })).status).toBe(200);
  });
});
