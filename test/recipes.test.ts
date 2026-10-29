import { beforeEach, describe, expect, it } from "vitest";
import { call, data, mint, reset } from "./helpers";

let agent: string;
let today: string;
beforeEach(async () => {
  await reset();
  agent = await mint("claude");
  today = (await data(agent, "whoami")).today;
});

// Batches count meals eaten after the batch was saved, so these tests log meals now, not on a past day.

// Per 100 g raw, so ingredients go in by grams.
const chicken = { name: "Chicken thigh, raw", serving_size: 100, serving_unit: "g", serving_grams: 100, calories: 177, protein_g: 24, carbs_g: 0, fat_g: 8.4 };
const rice = { name: "White rice, dry", serving_size: 100, serving_unit: "g", serving_grams: 100, calories: 365, protein_g: 7.1, carbs_g: 80, fat_g: 0.7 };
const oil = { name: "Olive oil", serving_size: 1, serving_unit: "tbsp", serving_grams: 13.5, calories: 119, protein_g: 0, carbs_g: 0, fat_g: 13.5 };
const broccoli = { name: "Broccoli", serving_size: 100, serving_unit: "g", serving_grams: 100, calories: 34, protein_g: 2.8, carbs_g: 6.6, fat_g: 0.4, fiber_g: 2.6 };

async function chickenDish(extra: Record<string, unknown> = {}) {
  const { food } = await data(agent, "save_food", chicken);
  return data(agent, "save_recipe", {
    name: "Chicken and rice",
    ingredients: [
      { food_id: food.id, grams: 1500 },
      { ...rice, grams: 1000 },
      { ...oil, servings: 3, note: "for the pan" },
      { ...broccoli, grams: 500 },
    ],
    total_grams: 5000,
    servings: 10,
    ...extra,
  });
}

describe("save_recipe", () => {
  it("calculates a cooked batch, logs 500 g of it, and counts what is left", async () => {
    const saved = await chickenDish();
    expect(saved.created).toBe(true);
    const recipe = saved.recipe;
    // 1500 g chicken + 1000 g rice + 3 tbsp oil + 500 g broccoli.
    expect(recipe.batch_totals).toMatchObject({ calories: 6832, protein_g: 445, carbs_g: 833, fat_g: 175.5, fiber_g: 13 });
    expect(recipe).toMatchObject({ servings: 10, serving_unit: "serving", total_grams: 5000, serving_grams: 500, raw_grams: 3040.5 });
    expect(recipe.per_serving).toMatchObject({ calories: 683.2, protein_g: 44.5, carbs_g: 83.3 });
    expect(recipe.per_100g).toMatchObject({ calories: 136.6, protein_g: 8.9 });
    expect(recipe.ingredients).toHaveLength(4);
    expect(recipe.ingredients[2]).toMatchObject({ name: "Olive oil", servings: 3, grams: 40.5, note: "for the pan", food_id: null });
    expect(recipe.incomplete_nutrients).toEqual(["fiber_g"]);
    expect(saved.warnings.join(" ")).toContain("fiber_g");

    const logged = await data(agent, "log_food", { food_id: recipe.id, grams: 500, meal: "lunch" });
    expect(logged.warnings).toBeUndefined();
    expect(logged.entry).toMatchObject({ name: "Chicken and rice", meal: "lunch", servings: 1, grams: 500 });
    expect(logged.entry.totals.calories).toBeCloseTo(683.2, 1);
    expect(logged.entry.totals.fat_g).toBe(17.6);
    expect(logged.day.totals.calories).toBeCloseTo(683.2, 1);

    const after = await data(agent, "get_recipe", { id: recipe.id });
    expect(after.recipe.batch).toMatchObject({ entry_count: 1, eaten_grams: 500, left_grams: 4500, left_servings: 9 });
    expect(after.recipe.log_count).toBe(1);

    // A later correction to the entry moves the leftover count with it.
    await data(agent, "update_entry", { id: logged.entry.id, grams: 750 });
    expect((await data(agent, "get_recipe", { id: recipe.id })).recipe.batch.left_grams).toBe(4250);
  });

  it("is found by search_foods, and kind separates recipes from foods", async () => {
    const { recipe } = await chickenDish();
    const recipes = await data(agent, "search_foods", { kind: "recipe" });
    expect(recipes.foods.map((f: any) => f.id)).toEqual([recipe.id]);
    expect(recipes.foods[0].is_recipe).toBe(true);
    expect(recipes.foods[0].per_serving.calories).toBe(683.2);
    const foods = await data(agent, "search_foods", { kind: "food", query: "chicken" });
    expect(foods.foods.map((f: any) => f.name)).toEqual(["Chicken thigh, raw"]);
    expect((await data(agent, "search_foods", { query: "chicken" })).foods).toHaveLength(2);
  });

  it("uses the raw weight when there is no cooked weight, and says so", async () => {
    const saved = await data(agent, "save_recipe", { name: "Salad", ingredients: [{ ...broccoli, grams: 200 }, { ...oil, servings: 1 }] });
    expect(saved.recipe).toMatchObject({ total_grams: 213.5, serving_grams: 100, serving_unit: "100 g" });
    expect(saved.warnings.join(" ")).toContain("raw weight");
    const logged = await data(agent, "log_food", { food_id: saved.recipe.id, grams: 50, date: "2026-10-20" });
    expect(logged.entry).toMatchObject({ servings: 0.5, grams: 50 });
  });

  it("needs a weight to log by grams, and still logs by servings", async () => {
    const saved = await data(agent, "save_recipe", {
      name: "Stew",
      servings: 4,
      ingredients: [{ name: "Stew pack", calories: 1600, protein_g: 120, carbs_g: 100, fat_g: 80 }],
    });
    expect(saved.recipe).toMatchObject({ total_grams: null, serving_grams: null, per_100g: null });
    expect(saved.recipe.per_serving.calories).toBe(400);
    expect(saved.warnings.join(" ")).toContain("cannot be logged by grams");
    expect((await call(agent, "log_food", { food_id: saved.recipe.id, grams: 300 })).status).toBe(400);
    await data(agent, "log_food", { food_id: saved.recipe.id, servings: 1.5 });
    expect((await data(agent, "get_recipe", { id: saved.recipe.id })).recipe.batch).toMatchObject({ eaten_grams: null, left_grams: null, left_servings: 2.5 });
  });

  it("starts a new batch when cooked again, and keeps past entries", async () => {
    const { recipe } = await chickenDish();
    await data(agent, "log_food", { food_id: recipe.id, grams: 500 });

    // Renaming or new notes does not start a new batch.
    const renamed = await data(agent, "save_recipe", { id: recipe.id, name: "Chicken & rice", notes: "Mom's" });
    expect(renamed.created).toBe(false);
    expect(renamed.recipe).toMatchObject({ name: "Chicken & rice", notes: "Mom's", total_grams: 5000 });
    expect(renamed.recipe.ingredients).toHaveLength(4);
    expect(renamed.recipe.batch.left_grams).toBe(4500);

    // The next batch came out drier: same ingredients, less weight, so each gram has more in it.
    const again = await data(agent, "save_recipe", { id: recipe.id, name: "Chicken & rice", total_grams: 4000 });
    expect(again.recipe.batch).toMatchObject({ entry_count: 0, left_grams: 4000 });
    expect(again.recipe.per_100g.calories).toBeCloseTo(170.8, 1);
    expect((await data(agent, "get_day", { date: today })).totals.calories).toBeCloseTo(683.2, 1);

    // New ingredients without a new weight keep the saved weight, with a warning.
    const changed = await data(agent, "save_recipe", { name: "chicken & RICE", ingredients: [{ ...rice, grams: 500 }] });
    expect(changed.recipe.id).toBe(recipe.id);
    expect(changed.recipe.total_grams).toBe(4000);
    expect(changed.warnings.join(" ")).toContain("stays at the saved 4000 g");
  });

  it("counts a meal by when it was eaten, so a late log of the old batch does not count against the new one", async () => {
    const { recipe } = await chickenDish();
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    await data(agent, "log_food", { food_id: recipe.id, grams: 300, consumed_at: hourAgo });
    await data(agent, "log_food", { food_id: recipe.id, grams: 300, date: "2026-01-02" });
    expect((await data(agent, "get_recipe", { id: recipe.id })).recipe.batch).toMatchObject({ entry_count: 0, left_grams: 5000 });

    // A meal with a time after the batch counts. A meal with only today's date counts too.
    await data(agent, "log_food", { food_id: recipe.id, grams: 400 });
    await data(agent, "log_food", { food_id: recipe.id, grams: 100, date: today });
    expect((await data(agent, "get_recipe", { id: recipe.id })).recipe.batch).toMatchObject({ entry_count: 2, eaten_grams: 500, left_grams: 4500 });
  });

  it("makes one serving 100 g of a weighed batch when servings is not sent, never the whole pot", async () => {
    const saved = await data(agent, "save_recipe", { name: "Chili", ingredients: [{ ...rice, grams: 500 }], total_grams: 1200 });
    expect(saved.recipe).toMatchObject({ servings: 12, serving_unit: "100 g", serving_grams: 100 });
    expect(saved.recipe.per_serving.calories).toBeCloseTo(152.1, 1);
    expect(saved.warnings.join(" ")).toContain("one serving is 100 g");
    expect(saved.recipe.batch.left_servings).toBe(12);

    // A new weight keeps 100 g servings. Then a real count of servings replaces them.
    const reweighed = await data(agent, "save_recipe", { id: saved.recipe.id, name: "Chili", total_grams: 1500 });
    expect(reweighed.recipe).toMatchObject({ servings: 15, serving_unit: "100 g", serving_grams: 100 });
    const counted = await data(agent, "save_recipe", { id: saved.recipe.id, name: "Chili", servings: 6 });
    expect(counted.recipe).toMatchObject({ servings: 6, serving_unit: "serving", serving_grams: 250 });
    expect((await data(agent, "save_recipe", { id: saved.recipe.id, name: "Chili", total_grams: 1800 })).recipe).toMatchObject({ servings: 6, serving_grams: 300 });

    // Without a weight, one serving is the batch, and the reply says so.
    const unweighed = await data(agent, "save_recipe", { name: "Soup", ingredients: [{ name: "Soup pack", calories: 800, protein_g: 40, carbs_g: 90, fat_g: 30 }] });
    expect(unweighed.recipe).toMatchObject({ servings: 1, serving_unit: "batch" });
    expect(unweighed.warnings.join(" ")).toContain("one serving is the full batch");
  });

  it("can use another recipe as an ingredient, and keeps its own snapshot", async () => {
    const sauce = await data(agent, "save_recipe", { name: "Pesto", ingredients: [{ ...oil, servings: 8 }], total_grams: 200 });
    const pasta = await data(agent, "save_recipe", {
      name: "Pesto pasta",
      ingredients: [
        { food_id: sauce.recipe.id, grams: 50 },
        { ...rice, name: "Pasta, dry", grams: 100 },
      ],
      total_grams: 300,
    });
    // 50 g of 200 g pesto is a quarter of 8 tbsp of oil.
    expect(pasta.recipe.ingredients[0]).toMatchObject({ name: "Pesto", grams: 50, food_id: sauce.recipe.id });
    expect(pasta.recipe.batch_totals.calories).toBeCloseTo(238 + 365, 1);

    await data(agent, "save_recipe", { id: sauce.recipe.id, name: "Pesto", total_grams: 400 });
    expect((await data(agent, "get_recipe", { id: pasta.recipe.id })).recipe.batch_totals.calories).toBeCloseTo(603, 1);
  });

  it("saves ad hoc ingredients to the library when asked, but not when another ingredient is bad", async () => {
    const bad = await call(agent, "save_recipe", { name: "Rice bowl", ingredients: [{ ...rice, grams: 100, save_food: true }, { name: "Egg", calories: 70 }] });
    expect(bad.status).toBe(400);
    expect((await data(agent, "search_foods", { query: "white rice" })).foods).toHaveLength(0);

    const saved = await data(agent, "save_recipe", { name: "Rice bowl", ingredients: [{ ...rice, grams: 100, save_food: true }] });
    const found = await data(agent, "search_foods", { query: "white rice", kind: "food" });
    expect(found.foods).toHaveLength(1);
    expect(saved.recipe.ingredients[0].food_id).toBe(found.foods[0].id);
  });

  it("refuses unsafe or incomplete input", async () => {
    const { recipe } = await chickenDish();
    const { food } = await data(agent, "save_food", { name: "Butter", calories: 100, protein_g: 0, carbs_g: 0, fat_g: 11 });

    // save_food must not overwrite a recipe's calculated nutrients, by id or by name.
    expect((await call(agent, "save_food", { id: recipe.id, name: "Chicken and rice", calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0 })).status).toBe(409);
    expect((await call(agent, "save_food", { name: "chicken and rice", calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0 })).status).toBe(409);
    expect((await call(agent, "log_food", { name: "Chicken and rice", calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0, save_food: true })).status).toBe(409);
    // A recipe must not take over a plain food's name.
    expect((await call(agent, "save_recipe", { name: "butter", ingredients: [{ food_id: food.id }] })).status).toBe(409);
    expect((await call(agent, "save_recipe", { id: food.id, name: "Butter", total_grams: 10 })).status).toBe(404);
    expect((await call(agent, "get_recipe", { id: food.id })).status).toBe(404);

    expect((await call(agent, "save_recipe", { id: recipe.id, name: "Chicken and rice", ingredients: [{ food_id: recipe.id }] })).status).toBe(400);
    expect((await call(agent, "save_recipe", { name: "Empty" })).status).toBe(400);
    expect((await call(agent, "save_recipe", { name: "Empty", ingredients: [] })).status).toBe(400);

    const bad = await call(agent, "save_recipe", { name: "Soup", ingredients: [{ food_id: food.id }, { name: "Carrot", calories: 41 }] });
    expect(bad.status).toBe(400);
    expect(bad.json.error?.message).toMatch(/^ingredients\[1\] \(Carrot\): .*protein_g/);
    const grams = await call(agent, "save_recipe", { name: "Soup", ingredients: [{ food_id: food.id, grams: 10 }] });
    expect(grams.json.error?.message).toContain("serving_grams");
    // Nothing was saved by the failed calls.
    expect((await data(agent, "search_foods", { query: "soup" })).foods).toHaveLength(0);
  });

  it("is removed with delete_food, and its entries stay", async () => {
    const { recipe } = await chickenDish();
    await data(agent, "log_food", { food_id: recipe.id, grams: 500, date: "2026-10-20" });
    await data(agent, "delete_food", { id: recipe.id });
    expect((await call(agent, "get_recipe", { id: recipe.id })).status).toBe(404);
    expect((await data(agent, "get_day", { date: "2026-10-20" })).totals.calories).toBeCloseTo(683.2, 1);
    // The name is free again.
    expect((await data(agent, "save_recipe", { name: "Chicken and rice", ingredients: [{ ...rice, grams: 100 }] })).created).toBe(true);
  });
});
