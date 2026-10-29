-- Recipes. A recipe is a row in foods with a list of ingredients. Its nutrient columns hold one
-- serving of the finished batch, calculated from the ingredients, so log_food treats it as any food.

-- Non-null marks the food as a recipe: the number of servings the batch makes.
ALTER TABLE foods ADD COLUMN recipe_servings REAL;
-- The weight of the finished batch in grams, if known. serving_grams = recipe_total_grams / recipe_servings.
ALTER TABLE foods ADD COLUMN recipe_total_grams REAL;
-- When the current batch started. Entries of the recipe logged after this time count as eaten from it.
ALTER TABLE foods ADD COLUMN recipe_batch_at TEXT;

CREATE TABLE recipe_ingredients (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES foods(id),
  position INTEGER NOT NULL,
  -- The saved food it came from, if any. The columns below are a snapshot, as on entries.
  food_id TEXT REFERENCES foods(id),
  name TEXT NOT NULL,
  brand TEXT,
  servings REAL NOT NULL,
  serving_size REAL,
  serving_unit TEXT,
  serving_grams REAL,
  calories REAL NOT NULL,
  protein_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  fat_g REAL NOT NULL,
  fiber_g REAL,
  sugar_g REAL,
  sodium_mg REAL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX recipe_ingredients_recipe ON recipe_ingredients (recipe_id, position);
CREATE INDEX entries_food ON entries (food_id, created_at) WHERE deleted_at IS NULL;
