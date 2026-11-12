
"use strict";

// ============================================
// APPLICATION SETTINGS
// ============================================

const API = "https://www.themealdb.com/api/json/v1/1";

const DAYS = [
  "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday", "Sunday"
];

const PLAN_DAYS = 7;
const MAX_RECIPES = 60;
const RANDOM_RECIPES = 30;
const PACKAGE_PENALTY = 0.12;

let weeklyPlan = [];
let recipePool = [];
let preferredIngredients = [];
let isGenerating = false;

// Cache previously downloaded and processed data.
const recipeCache = new Map();
const ingredientCache = new WeakMap();
const nameCache = new WeakMap();
const suitabilityCache = new WeakMap();

const $ = id => document.getElementById(id);

// ============================================
// GENERAL HELPERS
// ============================================

function setStatus(message) {
  if ($("status")) {
    $("status").textContent = message;
  }
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function roundUp(value) {
  return Math.ceil(value - 1e-7);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removePhrases(value, phrases) {
  let text = String(value || "").toLowerCase();

  for (const phrase of [...phrases].sort(
    (a, b) => b.length - a.length
  )) {
    text = text.replace(
      new RegExp(
        `\\b${escapeRegex(phrase)}\\b`, "gi"
      ),
      " "
    );
  }

  return text.replace(/\s+/g, " ").trim();
}

// ============================================
// INGREDIENT NORMALIZATION
// ============================================

function normalizeIngredient(name) {
  const cleaned = removePhrases(
    String(name || "")
      .toLowerCase()
      .replace(/[_ ,]+/g, " "),
    PREPARATION
  );

  return ALIASES[cleaned] || cleaned;
}

function cleanMeasure(measure) {
  let text = String(measure || "")
    .toLowerCase()
    .trim();

  text = text.replace(/\bcut into\b.*$/i, "");

  return removePhrases(
    removePhrases(text, PREPARATION),
    VAGUE
  )
    .replace(/,/g, "")
    .trim();
}

// ============================================
// WATER EXCLUSION
// ============================================

function isCookingWater(name) {
  const words = normalizeIngredient(name)
    .replace(/-/g, " ")
    .split(/\s+/);

  return (
    words.at(-1) === "water" &&
    words.slice(0, -1).every(
      word => WATER_WORDS.has(word)
    )
  );
}

// ============================================
// RECIPE INGREDIENTS
// ============================================

function getIngredients(meal) {
  if (ingredientCache.has(meal)) {
    return ingredientCache.get(meal);
  }

  const items = [];

  for (let i = 1; i <= 20; i++) {
    const raw = meal[`strIngredient${i}`];

    if (
      typeof raw === "string" &&
      raw.trim()
    ) {
      items.push({
        name: normalizeIngredient(raw),
        measure: String(
          meal[`strMeasure${i}`] || ""
        ).trim()
      });
    }
  }

  ingredientCache.set(meal, items);
  return items;
}

function ingredientNames(meal) {
  if (!nameCache.has(meal)) {
    nameCache.set(
      meal,
      new Set(
        getIngredients(meal).map(item => item.name)
      )
    );
  }

  return nameCache.get(meal);
}

// ============================================
// BALANCED RECIPE FAMILIARITY
// ============================================

function scoreRecipeSuitability(meal) {
  if (suitabilityCache.has(meal)) {
    return suitabilityCache.get(meal);
  }

  const ingredients = [...ingredientNames(meal)]
    .filter(name => !isCookingWater(name));

  const common = ingredients.filter(
    name => COMMON_INGREDIENTS.has(name)
  ).length;

  const accessibility = ingredients.length
    ? common / ingredients.length
    : 0;

  const uncommon = ingredients.length - common;

  const title = String(meal.strMeal || "")
    .toLowerCase();

  const familiarity = Math.min(
    FAMILIAR_MEAL_KEYWORDS.filter(
      keyword => title.includes(keyword)
    ).length,
    2
  );

  const score =
    accessibility * RECIPE_WEIGHTS.accessibility +
    familiarity * RECIPE_WEIGHTS.familiarity -
    uncommon * RECIPE_WEIGHTS.uncommonIngredientPenalty;

  suitabilityCache.set(meal, score);
  return score;
}

// ============================================
// API REQUESTS
// ============================================

async function fetchJSON(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Recipe service error: ${response.status}`
    );
  }

  return response.json();
}

async function searchIngredient(name) {
  const data = await fetchJSON(
    `${API}/filter.php?i=${encodeURIComponent(name)}`
  );

  return data.meals || [];
}

async function fetchMeal(id) {
  if (recipeCache.has(id)) {
    return recipeCache.get(id);
  }

  const data = await fetchJSON(
    `${API}/lookup.php?i=${encodeURIComponent(id)}`
  );

  const meal = data.meals?.[0] || null;

  if (meal) {
    recipeCache.set(id, meal);
  }

  return meal;
}

async function buildRecipePool(ingredients, limit) {
  const searches = await Promise.allSettled(
    ingredients.map(searchIngredient)
  );

  const unique = new Map();

  for (const result of searches) {
    if (result.status !== "fulfilled") continue;

    for (const meal of result.value) {
      unique.set(meal.idMeal, meal);
    }
  }

  const candidates = shuffle(
    [...unique.values()]
  ).slice(0, limit);

  const detailed = [];

  // Download full recipes in batches.
  for (let i = 0; i < candidates.length; i += 10) {
    const batch = candidates.slice(i, i + 10);

    const results = await Promise.allSettled(
      batch.map(meal => fetchMeal(meal.idMeal))
    );

    for (const result of results) {
      if (
        result.status === "fulfilled" &&
        result.value
      ) {
        detailed.push(result.value);
      }
    }
  }

  return detailed;
}

// ============================================
// WEEKLY OPTIMIZATION
// ============================================

function scorePlan(plan) {
  const counts = new Map();
  const categories = new Map();

  let preferenceScore = 0;
  let suitability = 0;

  for (const meal of plan) {
    suitability += scoreRecipeSuitability(meal);

    for (const name of ingredientNames(meal)) {
      if (isCookingWater(name)) continue;

      counts.set(
        name,
        (counts.get(name) || 0) + 1
      );

      if (preferredIngredients.some(
        preferred => name.includes(preferred)
      )) {
        preferenceScore++;
      }
    }

    const category =
      meal.strCategory || "Unknown";

    categories.set(
      category,
      (categories.get(category) || 0) + 1
    );
  }

  let reuse = 0;
  let repeatedCategories = 0;

  for (const count of counts.values()) {
    reuse += Math.max(0, count - 1);
  }

  for (const count of categories.values()) {
    repeatedCategories += Math.max(0, count - 1);
  }

  return (
    reuse * RECIPE_WEIGHTS.ingredientReuse +
    preferenceScore * RECIPE_WEIGHTS.userPreference -
    counts.size * RECIPE_WEIGHTS.ingredientVariety -
    repeatedCategories *
      RECIPE_WEIGHTS.categoryRepetition +
    suitability
  );
}

function optimizeWeek(pool, days = PLAN_DAYS) {
  if (pool.length < days) {
    throw new Error(
      "Not enough recipes found. Try different ingredients."
    );
  }

  let bestPlan = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 12; attempt++) {
    const plan = shuffle([...pool]).slice(0, days);

    for (let iteration = 0; iteration < 4; iteration++) {
      let improved = false;

      for (let day = 0; day < days; day++) {
        const used = new Set(
          plan
            .filter((_, index) => index !== day)
            .map(meal => meal.idMeal)
        );

        let winner = plan[day];
        let winnerScore = scorePlan(plan);

        for (const candidate of pool) {
          if (used.has(candidate.idMeal)) continue;

          const trial = [...plan];
          trial[day] = candidate;

          const score = scorePlan(trial);

          if (score > winnerScore) {
            winner = candidate;
            winnerScore = score;
          }
        }

        if (winner.idMeal !== plan[day].idMeal) {
          plan[day] = winner;
          improved = true;
        }
      }

      if (!improved) break;
    }

    const score = scorePlan(plan);

    if (score > bestScore) {
      bestScore = score;
      bestPlan = [...plan];
    }
  }

  return bestPlan;
}

// ============================================
// MEASUREMENT PARSING
// ============================================

function parseNumber(value) {
  let text = String(value).trim();

  for (const [symbol, fraction] of
    Object.entries(FRACTIONS)) {
    text = text.replaceAll(
      symbol,
      ` ${fraction} `
    );
  }

  let total = 0;

  for (const part of text.trim().split(/\s+/)) {
    if (part.includes("/")) {
      const [a, b] = part.split("/").map(Number);

      if (!Number.isFinite(a) || !b) return NaN;

      total += a / b;
    } else {
      const number = Number(part);

      if (!Number.isFinite(number)) return NaN;

      total += number;
    }
  }

  return total;
}

function parseMeasurement(name, raw) {
  const text = cleanMeasure(raw)
    .replace(/^(a|an)\s+/, "1 ")
    .replace(/\s+/g, " ")
    .trim();

  const match = text.match(
    /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?\s*[¼½¾⅓⅔⅛⅜⅝⅞]|[¼½¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+)?)\s*(.*)$/
  );

  if (!match) return null;

  const amount = parseNumber(match[1]);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = match[2]
    .trim()
    .replace(/\.$/, "")
    .replace(
      /^(extra large|extra small|large|medium|small)\b\s*/,
      ""
    );

  if (!unit) {
    if (name === "garlic") {
      return {
        amount,
        type: "count",
        unit: "clove"
      };
    }

    if (COUNTABLE.has(name)) {
      return {
        amount,
        type: "count",
        unit: name === "bay leaves"
          ? "leaf"
          : "whole"
      };
    }

    return null;
  }

  if (UNITS[unit]) {
    return {
      amount: amount * UNITS[unit][1],
      type: UNITS[unit][0],
      unit: ""
    };
  }

  if (COUNT_UNITS[unit]) {
    return {
      amount,
      type: "count",
      unit: COUNT_UNITS[unit]
    };
  }

  return null;
}

// ============================================
// SHOPPING QUANTITY CONVERSIONS
// ============================================

function normalizeShoppingQuantity(name, parsed) {
  if (
    WHOLE_WEIGHTS[name] &&
    parsed.type === "weight"
  ) {
    return {
      amount: parsed.amount / WHOLE_WEIGHTS[name],
      type: "count",
      unit: "whole"
    };
  }

  if (
    WHOLE_WEIGHTS[name] &&
    CHOPPED_CUP_WEIGHTS[name] &&
    parsed.type === "volume"
  ) {
    return {
      amount:
        (parsed.amount / ML_PER_CUP) *
        CHOPPED_CUP_WEIGHTS[name] /
        WHOLE_WEIGHTS[name],
      type: "count",
      unit: "whole"
    };
  }

  if (
    CUP_WEIGHTS[name] &&
    parsed.type === "volume"
  ) {
    return {
      amount:
        (parsed.amount / ML_PER_CUP) *
        CUP_WEIGHTS[name],
      type: "weight",
      unit: ""
    };
  }

  if (
    LIQUID_DENSITIES[name] &&
    parsed.type === "weight"
  ) {
    return {
      amount:
        parsed.amount / LIQUID_DENSITIES[name],
      type: "volume",
      unit: ""
    };
  }

  return parsed;
}

// ============================================
// PACKAGE OPTIMIZATION
// ============================================

function recommendPackages(required, catalog) {
  if (!(required > 0)) return null;

  const sizes = [...catalog.packages].sort(
    (a, b) => a - b
  );

  const largest = sizes.at(-1);

  const baselineCount = Math.max(
    0,
    Math.floor(required / largest) - 1
  );

  const baseline = baselineCount * largest;
  const remainder = required - baseline;

  let best = null;

  function search(total, count, start) {
    if (total + 1e-6 >= remainder) {
      const score =
        (total - remainder) / required +
        PACKAGE_PENALTY *
        (baselineCount + count - 1);

      if (
        !best ||
        score < best.score - 1e-9 ||
        (
          Math.abs(score - best.score) < 1e-9 &&
          count < best.count
        )
      ) {
        best = {
          total: baseline + total,
          count: baselineCount + count,
          score
        };
      }

      return;
    }

    if (count >= 6) return;

    for (let i = start; i < sizes.length; i++) {
      search(
        total + sizes[i],
        count + 1,
        i
      );
    }
  }

  search(0, 0, 0);
  return best;
}

// ============================================
// GROCERY FORMATTING
// ============================================

function formatCookingNumber(value) {
  return String(roundUp(value));
}

function formatWeight(grams) {
  if (grams >= G_PER_LB) {
    return `${formatCookingNumber(grams / G_PER_LB)} lb`;
  }

  if (grams >= G_PER_OZ) {
    return `${formatCookingNumber(grams / G_PER_OZ)} oz`;
  }

  return `${formatCookingNumber(grams)} g`;
}

function formatVolume(ml) {
  if (ml < 3 * ML_PER_TSP) {
    return `${formatCookingNumber(ml / ML_PER_TSP)} tsp`;
  }

  if (ml < 4 * ML_PER_TBSP) {
    return `${formatCookingNumber(ml / ML_PER_TBSP)} tbsp`;
  }

  if (ml < 4 * ML_PER_CUP) {
    const amount = formatCookingNumber(
      ml / ML_PER_CUP
    );

    return `${amount} ${
      amount === "1" ? "cup" : "cups"
    }`;
  }

  return `${formatCookingNumber(ml / 946.353)} qt`;
}

function formatCount(amount, unit) {
  const rounded = roundUp(amount);

  if (unit === "whole") {
    return String(rounded);
  }

  const plurals = {
    clove: "cloves",
    bulb: "bulbs",
    head: "heads",
    leaf: "leaves",
    bunch: "bunches",
    can: "cans",
    tin: "tins",
    slice: "slices",
    piece: "pieces",
    packet: "packets",
    package: "packages"
  };

  const label = rounded === 1
    ? unit
    : (plurals[unit] || `${unit}s`);

  return `${rounded} ${label}`;
}

function formatQuantity(parsed) {
  if (parsed.type === "weight") {
    return formatWeight(parsed.amount);
  }

  if (parsed.type === "volume") {
    return formatVolume(parsed.amount);
  }

  if (parsed.type === "count") {
    return formatCount(parsed.amount, parsed.unit);
  }

  return "";
}

function formatPackageTotal(total, type) {
  if (type === "weight") {
    return formatWeight(total);
  }

  if (total >= 3785.41) {
    return `${formatCookingNumber(total / 3785.41)} gallons`;
  }

  if (total >= 946.353) {
    return `${formatCookingNumber(total / 946.353)} qt`;
  }

  if (total >= 473.176) {
    return `${formatCookingNumber(total / 473.176)} pints`;
  }

  return `${formatCookingNumber(total)} mL`;
}

// ============================================
// GROCERY LIST
// ============================================

function renderGroceryList() {
  const list = $("grocery-list");
  list.replaceChildren();

  const groceries = new Map();

  for (const meal of weeklyPlan) {
    for (const ingredient of getIngredients(meal)) {
      const name = ingredient.name;

      if (isCookingWater(name)) continue;

      if (!groceries.has(name)) {
        groceries.set(name, {
          quantities: [],
          unspecified: false
        });
      }

      const entry = groceries.get(name);

      const parsed = parseMeasurement(
        name,
        ingredient.measure
      );

      if (!parsed) {
        entry.unspecified = true;
        continue;
      }

      entry.quantities.push(
        normalizeShoppingQuantity(name, parsed)
      );
    }
  }

  const sorted = [...groceries.entries()].sort(
    (a, b) => a[0].localeCompare(b[0])
  );

  for (const [name, entry] of sorted) {
    const quantities = [];
    const catalog = PACKAGE_CATALOG[name];

    let required = 0;
    const remaining = [];

    for (const parsed of entry.quantities) {
      if (
        catalog &&
        parsed.type === catalog.type
      ) {
        required += parsed.amount;
      } else {
        remaining.push(parsed);
      }
    }

    if (catalog && required > 0) {
      const recommendation = recommendPackages(
        required,
        catalog
      );

      if (recommendation) {
        quantities.push(
          formatPackageTotal(
            recommendation.total,
            catalog.type
          )
        );
      }
    }

    const totals = new Map();

    for (const parsed of remaining) {
      const key =
        `${parsed.type}|${parsed.unit || ""}`;

      if (!totals.has(key)) {
        totals.set(key, {
          ...parsed,
          amount: 0
        });
      }

      totals.get(key).amount += parsed.amount;
    }

    for (const total of totals.values()) {
      quantities.push(formatQuantity(total));
    }

    const item = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";

    const label = document.createElement("span");

    const display = quantities
      .filter(Boolean)
      .join(" + ");

    label.textContent = display
      ? ` ${name}: ${display}`
      : ` ${name} (quantity unspecified)`;

    item.append(checkbox, label);
    list.appendChild(item);
  }
}

// ============================================
// GENERATE WEEK
// ============================================

// ============================================
// WEEKLY PLAN ANALYSIS
// ============================================

const RANDOM_COMPARISONS = 200;

// Count how often each ingredient appears
// across different recipes.
function calculateIngredientMetrics(plan) {
  const counts = new Map();

  for (const meal of plan) {
    for (const name of ingredientNames(meal)) {
      if (isCookingWater(name)) continue;

      counts.set(
        name,
        (counts.get(name) || 0) + 1
      );
    }
  }

  const unique = counts.size;

  const reused = [...counts.values()].filter(
    count => count >= 2
  ).length;

  return {
    unique,
    reused,
    reusePercentage: unique
      ? (reused / unique) * 100
      : 0
  };
}

// Estimate unused package quantities.
//
// Only ingredients with configured package
// sizes and compatible measurements count.
// This does not estimate spoilage or actual
// food waste.

function calculatePackageLeftovers(plan) {
  const requirements = new Map();

  for (const meal of plan) {
    for (const ingredient of getIngredients(meal)) {
      const name = ingredient.name;

      if (isCookingWater(name)) continue;

      const catalog = PACKAGE_CATALOG[name];
      if (!catalog) continue;

      const parsed = parseMeasurement(
        name,
        ingredient.measure
      );

      if (!parsed) continue;

      const normalized = normalizeShoppingQuantity(
        name,
        parsed
      );

      if (normalized.type !== catalog.type) {
        continue;
      }

      requirements.set(
        name,
        (requirements.get(name) || 0) +
          normalized.amount
      );
    }
  }

  let purchased = 0;
  let unused = 0;
  let measuredIngredients = 0;

  // Weight and volume must not be added together.
  // Calculate a separate ratio for each ingredient,
  // then average those ratios.

  for (const [name, required] of requirements) {
    const catalog = PACKAGE_CATALOG[name];

    const recommendation = recommendPackages(
      required,
      catalog
    );

    if (!recommendation || !recommendation.total) {
      continue;
    }

    const leftover = Math.max(
      0,
      recommendation.total - required
    );

    unused += leftover / recommendation.total;
    purchased += 1;
    measuredIngredients++;
  }

  return {
    percentage: purchased
      ? (unused / purchased) * 100
      : null,
    measuredIngredients
  };
}

// Generate a random seven-meal combination
// without changing the user's actual plan.
function createRandomPlan(pool, days) {
  return shuffle([...pool]).slice(0, days);
}

// Compare the selected plan with random plans
// from the same recipe pool.
function compareWithRandomPlans(
  plan,
  pool,
  samples = RANDOM_COMPARISONS
) {
  if (pool.length < plan.length || !plan.length) {
    return null;
  }

  let totalUnique = 0;
  let totalReuse = 0;

  for (let i = 0; i < samples; i++) {
    const randomPlan = createRandomPlan(
      pool,
      plan.length
    );

    const metrics = calculateIngredientMetrics(
      randomPlan
    );

    totalUnique += metrics.unique;
    totalReuse += metrics.reusePercentage;
  }

  return {
    averageUnique: totalUnique / samples,
    averageReuse: totalReuse / samples,
    samples
  };
}

// Display the results in the dashboard.
function renderPlanAnalysis() {
  const section = $("plan-analysis");

  if (!section || weeklyPlan.length === 0) {
    if (section) section.hidden = true;
    return;
  }

  const metrics = calculateIngredientMetrics(
    weeklyPlan
  );

  const leftovers = calculatePackageLeftovers(
    weeklyPlan
  );

  const comparison = compareWithRandomPlans(
    weeklyPlan,
    recipePool
  );

  $("reuse-percentage").textContent =
    `${Math.round(metrics.reusePercentage)}%`;

  $("unique-ingredients").textContent =
    metrics.unique;

  $("reused-ingredients").textContent =
    metrics.reused;

  $("package-leftovers").textContent =
    leftovers.percentage === null
      ? "N/A"
      : `${Math.round(leftovers.percentage)}%`;

  $("optimized-count").textContent =
    `${metrics.unique} ingredients`;

  if (comparison) {
    $("random-count").textContent =
      `${comparison.averageUnique.toFixed(1)} ingredients`;

    const difference =
      comparison.averageUnique - metrics.unique;

    const summary = $("comparison-summary");

    if (difference > 0) {
      summary.textContent =
        `Your plan uses approximately ` +
        `${difference.toFixed(1)} fewer distinct ` +
        `ingredients than the average of ` +
        `${comparison.samples} random plans.`;
    } else if (difference < 0) {
      summary.textContent =
        `Your plan uses approximately ` +
        `${Math.abs(difference).toFixed(1)} more ` +
        `distinct ingredients than the random average.`;
    } else {
      summary.textContent =
        "Your plan uses approximately the same " +
        "number of ingredients as random plans.";
    }
  } else {
    $("random-count").textContent = "N/A";

    $("comparison-summary").textContent =
      "Not enough recipes for comparison.";
  }

  section.hidden = false;
}

async function generateWeek(random = false) {
  if (isGenerating) return;

  const requested = random
    ? []
    : $("ingredient-input").value
        .split(",")
        .map(normalizeIngredient)
        .filter(Boolean);

  if (!random && !requested.length) {
    setStatus(
      "Enter ingredients or choose Random Week."
    );
    return;
  }

  isGenerating = true;

  $("find-recipes").disabled = true;
  $("random-week").disabled = true;

  setStatus("Finding and optimizing recipes...");

  try {
    const terms = random
      ? shuffle([
          "chicken", "beef", "potato", "rice",
          "tomato", "salmon", "pork", "egg"
        ]).slice(0, 3)
      : requested;

    const pool = await buildRecipePool(
      terms,
      random ? RANDOM_RECIPES : MAX_RECIPES
    );

    preferredIngredients = requested;

    const plan = optimizeWeek(pool);

    recipePool = pool;
    weeklyPlan = plan;

    renderWeek();
    renderGroceryList();
    renderPlanAnalysis();

    setStatus("Your weekly meal plan is ready!");
  } catch (error) {
    console.error(error);
    setStatus(
      error.message || "Could not generate meals."
    );
  } finally {
    isGenerating = false;
    $("find-recipes").disabled = false;
    $("random-week").disabled = false;
  }
}

// ============================================
// MEAL SWAPPING
// ============================================

function findSwapOptions(dayIndex) {
  if (!weeklyPlan[dayIndex]) return [];

  const used = new Set(
    weeklyPlan.map(meal => meal.idMeal)
  );

  return recipePool
    .filter(meal => !used.has(meal.idMeal))
    .map(meal => {
      const trial = [...weeklyPlan];
      trial[dayIndex] = meal;

      return {
        meal,
        score: scorePlan(trial)
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function showSwapOptions(dayIndex) {
  const container = $(`swap-options-${dayIndex}`);
  if (!container) return;

  container.replaceChildren();

  const options = findSwapOptions(dayIndex);

  if (!options.length) {
    container.textContent =
      "No alternative recipes available.";
    return;
  }

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.meal.strMeal;

    button.addEventListener("click", () => {
      weeklyPlan[dayIndex] = option.meal;

      renderWeek();
      renderGroceryList();
      renderPlanAnalysis();

      setStatus(
        "Meal swapped. Grocery list updated!"
      );
    });

    container.appendChild(button);
  }
}

// ============================================
// CALENDAR DISPLAY
// ============================================

function renderWeek() {
  const results = $("recipe-results");
  results.replaceChildren();

  weeklyPlan.forEach((meal, index) => {
    const card = document.createElement("div");
    card.className = "meal-card";

    const dayHeader = document.createElement("div");
    dayHeader.className = "meal-day";
    dayHeader.textContent = DAYS[index];

    const image = document.createElement("img");
    image.src = meal.strMealThumb;
    image.alt = meal.strMeal;
    image.loading = "lazy";

    const content = document.createElement("div");
    content.className = "meal-content";

    const title = document.createElement("h3");
    title.textContent = meal.strMeal;

    const link = document.createElement("a");
    link.href =
      `https://www.themealdb.com/meal/${
        encodeURIComponent(meal.idMeal)
      }`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View Recipe";

    const swapButton = document.createElement("button");
    swapButton.type = "button";
    swapButton.textContent = "Swap Meal";

    swapButton.addEventListener("click", () => {
      showSwapOptions(index);
    });

    const swapContainer = document.createElement("div");
    swapContainer.id = `swap-options-${index}`;
    swapContainer.className = "swap-options";

    content.append(
      title,
      link,
      swapButton,
      swapContainer
    );

    card.append(
      dayHeader,
      image,
      content
    );

    results.appendChild(card);
  });
}

// ============================================
// RESET
// ============================================

function resetRecipes() {
  if (isGenerating) return;

  weeklyPlan = [];
  recipePool = [];
  preferredIngredients = [];

  $("ingredient-input").value = "";
  $("recipe-results").replaceChildren();
  $("grocery-list").replaceChildren();

  setStatus(
    "Choose ingredients to generate a new week."
  );
  renderPlanAnalysis();
}

// ============================================
// EVENT LISTENERS
// ============================================

$("find-recipes").addEventListener(
  "click",
  () => generateWeek(false)
);

$("random-week").addEventListener(
  "click",
  () => generateWeek(true)
);

$("reset-button").addEventListener(
  "click",
  resetRecipes
);
