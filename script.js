
"use strict";

const API = "https://www.themealdb.com/api/json/v1/1";

const DAYS = [
  "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday", "Sunday"
];

const PLAN_DAYS = 7;
const MAX_RECIPES = 60;
const PACKAGE_PENALTY = 0.12;

const ML_PER_TSP = 4.92892;
const ML_PER_TBSP = 14.7868;
const ML_PER_CUP = 236.588;
const G_PER_OZ = 28.3495;
const G_PER_LB = 453.592;

let weeklyPlan = [];
let recipePool = [];
let preferredIngredients = [];
let isGenerating = false;

const ingredientCache = new WeakMap();
const nameCache = new WeakMap();

// ============================================
// GENERAL HELPERS
// ============================================

const $ = id => document.getElementById(id);

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

// ============================================
// INGREDIENT NORMALIZATION
// ============================================

const PREPARATION = [
  "finely chopped", "roughly chopped",
  "thinly sliced", "finely diced",
  "freshly grated", "finely minced",
  "chopped", "diced", "minced",
  "sliced", "peeled", "shredded",
  "grated", "crushed", "cubed",
  "julienned", "halved", "quartered",
  "washed", "rinsed", "drained",
  "seeded", "deseeded", "trimmed"
];

const VAGUE = [
  "to taste", "to serve", "for serving",
  "for frying", "as needed", "optional",
  "pinch", "drizzle", "splash"
];

const ALIASES = {
  onion: "onions",
  tomato: "tomatoes",
  potato: "potatoes",
  carrot: "carrots",
  egg: "eggs",
  lemon: "lemons",
  lime: "limes",
  "garlic clove": "garlic",
  "garlic cloves": "garlic",
  "clove of garlic": "garlic",
  "cloves of garlic": "garlic",
  "bay leaf": "bay leaves",
  "spring onion": "scallions",
  "spring onions": "scallions",
  scallion: "scallions",
  "extra virgin olive oil": "olive oil",
  "plain flour": "all-purpose flour",
  "all purpose flour": "all-purpose flour",
  "white sugar": "granulated sugar",
  hotsauce: "hot sauce",
  "chili powder": "chilli powder",
  "green peppers": "green pepper",
  "red peppers": "red pepper"
};

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

const WATER_WORDS = new Set([
  "boiling", "boiled", "warm", "hot",
  "cold", "ice", "iced", "lukewarm",
  "room", "temperature", "filtered",
  "distilled", "tap", "fresh", "plain",
  "chilled", "cool", "clean", "drinking",
  "tepid", "heated", "potable"
]);

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
// API FUNCTIONS
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
  const data = await fetchJSON(
    `${API}/lookup.php?i=${encodeURIComponent(id)}`
  );

  return data.meals?.[0] || null;
}

async function buildRecipePool(ingredients) {
  const searches = await Promise.allSettled(
    ingredients.map(searchIngredient)
  );

  const unique = new Map();

  for (const result of searches) {
    if (result.status === "fulfilled") {
      for (const meal of result.value) {
        unique.set(meal.idMeal, meal);
      }
    }
  }

  const candidates = shuffle(
    [...unique.values()]
  ).slice(0, MAX_RECIPES);

  const detailed = [];

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
// WEEKLY MEAL OPTIMIZATION
// ============================================

function scorePlan(plan) {
  const counts = new Map();
  const categories = new Map();

  let preferences = 0;

  for (const meal of plan) {
    for (const name of ingredientNames(meal)) {
      if (isCookingWater(name)) continue;

      counts.set(
        name,
        (counts.get(name) || 0) + 1
      );

      if (preferredIngredients.some(
        preferred => name.includes(preferred)
      )) {
        preferences++;
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

  for (const count of counts.values()) {
    reuse += Math.max(0, count - 1);
  }

  let repeatedCategories = 0;

  for (const count of categories.values()) {
    repeatedCategories += Math.max(0, count - 1);
  }

  return (
    reuse * 3 +
    preferences * 2 -
    counts.size * 0.4 -
    repeatedCategories * 0.5
  );
}

function optimizeWeek(pool, days = PLAN_DAYS) {
  if (pool.length < days) {
    throw new Error(
      "Not enough recipes found. Try more common ingredients."
    );
  }

  let bestPlan = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 15; attempt++) {
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

const FRACTIONS = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875
};

const UNITS = {
  tsp: ["volume", ML_PER_TSP],
  teaspoon: ["volume", ML_PER_TSP],
  teaspoons: ["volume", ML_PER_TSP],

  tbsp: ["volume", ML_PER_TBSP],
  tbs: ["volume", ML_PER_TBSP],
  tblsp: ["volume", ML_PER_TBSP],
  tablespoon: ["volume", ML_PER_TBSP],
  tablespoons: ["volume", ML_PER_TBSP],

  cup: ["volume", ML_PER_CUP],
  cups: ["volume", ML_PER_CUP],

  "fl oz": ["volume", 29.5735],
  pint: ["volume", 473.176],
  pints: ["volume", 473.176],
  quart: ["volume", 946.353],
  quarts: ["volume", 946.353],
  gallon: ["volume", 3785.41],
  gallons: ["volume", 3785.41],

  ml: ["volume", 1],
  milliliter: ["volume", 1],
  milliliters: ["volume", 1],
  l: ["volume", 1000],
  liter: ["volume", 1000],
  liters: ["volume", 1000],

  g: ["weight", 1],
  gram: ["weight", 1],
  grams: ["weight", 1],
  kg: ["weight", 1000],
  kilogram: ["weight", 1000],
  kilograms: ["weight", 1000],

  oz: ["weight", G_PER_OZ],
  ounce: ["weight", G_PER_OZ],
  ounces: ["weight", G_PER_OZ],

  lb: ["weight", G_PER_LB],
  lbs: ["weight", G_PER_LB],
  pound: ["weight", G_PER_LB],
  pounds: ["weight", G_PER_LB]
};

const COUNT_UNITS = {
  clove: "clove",
  cloves: "clove",
  bulb: "bulb",
  bulbs: "bulb",
  head: "head",
  heads: "head",
  leaf: "leaf",
  leaves: "leaf",
  can: "can",
  cans: "can",
  tin: "tin",
  tins: "tin",
  slice: "slice",
  slices: "slice",
  piece: "piece",
  pieces: "piece",
  bunch: "bunch",
  bunches: "bunch",
  packet: "packet",
  packets: "packet",
  package: "package",
  packages: "package",
  whole: "whole"
};

const COUNTABLE = new Set([
  "eggs", "egg white", "lemons", "limes",
  "onions", "red onions", "carrots",
  "potatoes", "tomatoes", "celery",
  "leek", "green pepper", "red pepper",
  "bell peppers", "swede", "bay leaves",
  "garlic", "chicken stock cube",
  "beef stock cube", "vegetable stock cube",
  "pita bread", "cabbage"
]);

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

      if (!Number.isFinite(a) || !b) {
        return NaN;
      }

      total += a / b;
    } else {
      const number = Number(part);

      if (!Number.isFinite(number)) {
        return NaN;
      }

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
// INGREDIENT-SPECIFIC CONVERSIONS
// ============================================

const CUP_WEIGHTS = {
  "all-purpose flour": 120,
  flour: 120,
  "granulated sugar": 200,
  sugar: 200,
  rice: 185,
  "basmati rice": 185,
  "jasmine rice": 185,
  butter: 227,
  "peanut butter": 258,
  "tomato puree": 245,
  "tomato sauce": 245,
  "greek yogurt": 245
};

const WHOLE_WEIGHTS = {
  onions: 150,
  "red onions": 150,
  carrots: 75,
  potatoes: 175,
  tomatoes: 125,
  celery: 40,
  leek: 150,
  lemons: 100,
  limes: 70,
  "green pepper": 150,
  "red pepper": 150,
  "bell peppers": 150,
  swede: 500
};

const CHOPPED_CUP_WEIGHTS = {
  onions: 160,
  "red onions": 160,
  carrots: 128,
  celery: 101,
  tomatoes: 180,
  "green pepper": 149,
  "red pepper": 149,
  "bell peppers": 149
};

const LIQUID_DENSITIES = {
  milk: 1.03,
  "whole milk": 1.03,
  "beef stock": 1.01,
  "chicken stock": 1.01,
  "vegetable stock": 1.01,
  "tomato sauce": 1.04,
  "olive oil": 0.91,
  "vegetable oil": 0.92
};

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
// PACKAGE SIZES
// ============================================

const PACKAGE_CATALOG = {
  rice: {
    type: "weight",
    packages: [454, 907, 2268, 4536]
  },

  "basmati rice": {
    type: "weight",
    packages: [454, 907, 2268]
  },

  "jasmine rice": {
    type: "weight",
    packages: [454, 907, 2268]
  },

  "all-purpose flour": {
    type: "weight",
    packages: [907, 2268, 4536]
  },

  "granulated sugar": {
    type: "weight",
    packages: [907, 1814, 4536]
  },

  butter: {
    type: "weight",
    packages: [113, 227, 454]
  },

  pasta: {
    type: "weight",
    packages: [454, 907]
  },

  "olive oil": {
    type: "volume",
    packages: [250, 500, 750, 1000]
  },

  "vegetable oil": {
    type: "volume",
    packages: [473, 946, 1893]
  },

  milk: {
    type: "volume",
    packages: [473, 946, 1893, 3785]
  }
};

// ============================================
// BALANCED PACKAGE OPTIMIZATION
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
// DISPLAY FORMATTING
// ============================================

// Round only after ingredient totals are combined.

function formatCookingNumber(value) {
  return String(roundUp(value));
}

function formatWeight(grams) {
  if (grams >= G_PER_LB) {
    return (
      `${formatCookingNumber(grams / G_PER_LB)} lb`
    );
  }

  if (grams >= G_PER_OZ) {
    return (
      `${formatCookingNumber(grams / G_PER_OZ)} oz`
    );
  }

  return `${formatCookingNumber(grams)} g`;
}

function formatVolume(ml) {
  if (ml < 3 * ML_PER_TSP) {
    return (
      `${formatCookingNumber(ml / ML_PER_TSP)} tsp`
    );
  }

  if (ml < 4 * ML_PER_TBSP) {
    return (
      `${formatCookingNumber(ml / ML_PER_TBSP)} tbsp`
    );
  }

  if (ml < 4 * ML_PER_CUP) {
    const amount = formatCookingNumber(
      ml / ML_PER_CUP
    );

    return `${amount} ${
      amount === "1" ? "cup" : "cups"
    }`;
  }

  return (
    `${formatCookingNumber(ml / 946.353)} qt`
  );
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
    return formatCount(
      parsed.amount,
      parsed.unit
    );
  }

  return "";
}

function formatPackageTotal(total, type) {
  if (type === "weight") {
    return formatWeight(total);
  }

  if (total >= 3785.41) {
    return (
      `${formatCookingNumber(total / 3785.41)} gallons`
    );
  }

  if (total >= 946.353) {
    return (
      `${formatCookingNumber(total / 946.353)} qt`
    );
  }

  if (total >= 473.176) {
    return (
      `${formatCookingNumber(total / 473.176)} pints`
    );
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

      // Remove ordinary cooking water.
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

    // Recommend a practical package quantity.
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

    // Combine compatible ingredient quantities.
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

async function generateWeek(random = false) {
  if (isGenerating) return;

  const input = $("ingredient-input");

  const requested = random
    ? []
    : input.value
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
        ]).slice(0, 5)
      : requested;

    const pool = await buildRecipePool(terms);

    preferredIngredients = requested;

    const plan = optimizeWeek(pool);

    recipePool = pool;
    weeklyPlan = plan;

    renderWeek();
    renderGroceryList();

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

      setStatus(
        "Meal swapped. Grocery list updated!"
      );
    });

    container.appendChild(button);
  }
}

// ============================================
// DISPLAY WEEKLY PLAN
// ============================================

function renderWeek() {
  

  const results = $("recipe-results");
  results.replaceChildren();

  weeklyPlan.forEach((meal, index) => {

    // Calendar day container
    const card = document.createElement("div");
    card.className = "meal-card";

    // Day heading
    const dayHeader = document.createElement("div");
    dayHeader.className = "meal-day";
    dayHeader.textContent = DAYS[index];

    // Recipe image
    const image = document.createElement("img");
    image.src = meal.strMealThumb;
    image.alt = meal.strMeal;
    image.loading = "lazy";

    // Content container
    const content = document.createElement("div");
    content.className = "meal-content";

    // Recipe title
    const title = document.createElement("h3");
    title.textContent = meal.strMeal;

    // Recipe link
    const link = document.createElement("a");

    link.href =
      `https://www.themealdb.com/meal/${
        encodeURIComponent(meal.idMeal)
      }`;

    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View Recipe";

    // Swap button
    const swapButton = document.createElement("button");
    swapButton.type = "button";
    swapButton.textContent = "Swap Meal";

    swapButton.addEventListener("click", () => {
      showSwapOptions(index);
    });

    // Swap options
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
  if (isGenerating) {
    setStatus(
      "Please wait for generation to finish."
    );
    return;
  }

  weeklyPlan = [];
  recipePool = [];
  preferredIngredients = [];

  $("ingredient-input").value = "";
  $("recipe-results").replaceChildren();
  $("grocery-list").replaceChildren();

  setStatus(
    "Choose ingredients to generate a new week."
  );
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
