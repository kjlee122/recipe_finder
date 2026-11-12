
"use strict";

// ============================================
// INGREDIENT CONFIGURATION
// ============================================

const INGREDIENT_GROUPS = {
  garlic: [
    "garlic clove", "garlic cloves",
    "clove of garlic", "cloves of garlic"
  ],
  onions: ["onion", "onions"],
  tomatoes: ["tomato", "tomatoes"],
  potatoes: ["potato", "potatoes"],
  carrots: ["carrot", "carrots"],
  eggs: ["egg", "eggs"],
  lemons: ["lemon", "lemons"],
  limes: ["lime", "limes"],
  "bay leaves": ["bay leaf", "bay leaves"],
  scallions: [
    "scallion", "scallions",
    "spring onion", "spring onions"
  ],
  "olive oil": [
    "olive oil", "extra virgin olive oil"
  ],
  "all-purpose flour": [
    "plain flour", "all purpose flour",
    "all-purpose flour"
  ],
  "granulated sugar": [
    "white sugar", "granulated sugar"
  ],
  "hot sauce": ["hot sauce", "hotsauce"],
  "chilli powder": [
    "chilli powder", "chili powder"
  ],
  "green pepper": [
    "green pepper", "green peppers"
  ],
  "red pepper": [
    "red pepper", "red peppers"
  ]
};

const ALIASES = Object.fromEntries(
  Object.entries(INGREDIENT_GROUPS).flatMap(
    ([standard, variations]) =>
      variations.map(name => [name, standard])
  )
);

// ============================================
// PREPARATION INSTRUCTIONS
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

const WATER_WORDS = new Set([
  "boiling", "boiled", "warm", "hot",
  "cold", "ice", "iced", "lukewarm",
  "room", "temperature", "filtered",
  "distilled", "tap", "fresh", "plain",
  "chilled", "cool", "clean", "drinking",
  "tepid", "heated"
]);

// ============================================
// RECIPE FAMILIARITY
// ============================================

const COMMON_INGREDIENTS = new Set([
  "chicken", "chicken breast", "chicken thighs",
  "beef", "ground beef", "pork", "bacon",
  "sausage", "turkey", "salmon", "tuna",
  "eggs", "milk", "whole milk", "butter",
  "cheese", "cheddar cheese", "mozzarella",
  "parmesan cheese", "heavy cream",
  "greek yogurt", "sour cream",

  "rice", "white rice", "basmati rice",
  "jasmine rice", "pasta", "spaghetti",
  "noodles", "bread", "breadcrumbs",
  "tortillas", "flour", "all-purpose flour",
  "potatoes", "sweet potatoes",

  "onions", "red onions", "garlic",
  "carrots", "celery", "tomatoes",
  "bell peppers", "green pepper",
  "red pepper", "broccoli", "spinach",
  "lettuce", "cabbage", "mushrooms",
  "corn", "sweetcorn", "peas",
  "green beans", "scallions",
  "lemons", "limes", "leek",

  "olive oil", "vegetable oil",
  "salt", "pepper", "black pepper",
  "paprika", "chilli powder", "cumin",
  "oregano", "basil", "parsley",
  "thyme", "cinnamon", "sugar",
  "granulated sugar", "baking powder",

  "chicken stock", "beef stock",
  "vegetable stock", "tomato sauce",
  "tomato puree", "soy sauce",
  "ketchup", "mustard", "mayonnaise",
  "vinegar", "white wine vinegar",

  "beans", "black beans", "kidney beans",
  "chickpeas", "lentils", "oats",
  "honey", "peanut butter", "ginger"
]);

const FAMILIAR_MEAL_KEYWORDS = [
  "chicken", "beef", "pasta",
  "spaghetti", "lasagna", "lasagne",
  "pizza", "burger", "sandwich",
  "taco", "burrito", "quesadilla",
  "fajita", "stir fry", "stir-fry",
  "fried rice", "roast", "baked",
  "grilled", "soup", "stew",
  "chili", "casserole", "meatballs",
  "meatloaf", "salmon", "potatoes",
  "macaroni", "rice bowl", "pot pie"
];

const RECIPE_WEIGHTS = {
  ingredientReuse: 3,
  userPreference: 2,
  ingredientVariety: 0.4,
  categoryRepetition: 0.5,
  familiarity: 2,
  accessibility: 3,
  uncommonIngredientPenalty: 1.5
};

// ============================================
// MEASUREMENT CONFIGURATION
// ============================================

const ML_PER_TSP = 4.92892;
const ML_PER_TBSP = 14.7868;
const ML_PER_CUP = 236.588;
const G_PER_OZ = 28.3495;
const G_PER_LB = 453.592;

const FRACTIONS = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 1 / 3, "⅔": 2 / 3,
  "⅛": 0.125, "⅜": 0.375,
  "⅝": 0.625, "⅞": 0.875
};

const UNIT_GROUPS = {
  tsp: {
    type: "volume",
    factor: ML_PER_TSP,
    names: ["tsp", "teaspoon", "teaspoons"]
  },
  tbsp: {
    type: "volume",
    factor: ML_PER_TBSP,
    names: [
      "tbsp", "tbs", "tblsp",
      "tablespoon", "tablespoons"
    ]
  },
  cup: {
    type: "volume",
    factor: ML_PER_CUP,
    names: ["cup", "cups"]
  },
  "fl oz": {
    type: "volume",
    factor: 29.5735,
    names: ["fl oz", "fluid ounce", "fluid ounces"]
  },
  pint: {
    type: "volume",
    factor: 473.176,
    names: ["pint", "pints"]
  },
  quart: {
    type: "volume",
    factor: 946.353,
    names: ["quart", "quarts"]
  },
  gallon: {
    type: "volume",
    factor: 3785.41,
    names: ["gallon", "gallons"]
  },
  ml: {
    type: "volume",
    factor: 1,
    names: ["ml", "milliliter", "milliliters"]
  },
  liter: {
    type: "volume",
    factor: 1000,
    names: ["l", "liter", "liters", "litre", "litres"]
  },
  gram: {
    type: "weight",
    factor: 1,
    names: ["g", "gram", "grams"]
  },
  kilogram: {
    type: "weight",
    factor: 1000,
    names: ["kg", "kilogram", "kilograms"]
  },
  ounce: {
    type: "weight",
    factor: G_PER_OZ,
    names: ["oz", "ounce", "ounces"]
  },
  pound: {
    type: "weight",
    factor: G_PER_LB,
    names: ["lb", "lbs", "pound", "pounds"]
  }
};

const UNITS = Object.fromEntries(
  Object.values(UNIT_GROUPS).flatMap(group =>
    group.names.map(name => [
      name,
      [group.type, group.factor]
    ])
  )
);

const COUNT_GROUPS = {
  clove: ["clove", "cloves"],
  bulb: ["bulb", "bulbs"],
  head: ["head", "heads"],
  leaf: ["leaf", "leaves"],
  can: ["can", "cans"],
  tin: ["tin", "tins"],
  slice: ["slice", "slices"],
  piece: ["piece", "pieces"],
  bunch: ["bunch", "bunches"],
  packet: ["packet", "packets"],
  package: ["package", "packages"],
  whole: ["whole"]
};

const COUNT_UNITS = Object.fromEntries(
  Object.entries(COUNT_GROUPS).flatMap(
    ([unit, variations]) =>
      variations.map(name => [name, unit])
  )
);

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

// ============================================
// INGREDIENT-SPECIFIC CONVERSIONS
// ============================================

// Approximate grams per US cup.
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

// Approximate grams per whole item.
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

// Approximate grams per cup of chopped produce.
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

// Approximate grams per milliliter.
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

// ============================================
// PACKAGE CATALOG
// ============================================

// Package amounts are grams or milliliters.
// Approximate US retail sizes.

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
  flour: {
    type: "weight",
    packages: [907, 2268, 4536]
  },
  "granulated sugar": {
    type: "weight",
    packages: [907, 1814, 4536]
  },
  sugar: {
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
  spaghetti: {
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
  },
  "whole milk": {
    type: "volume",
    packages: [473, 946, 1893, 3785]
  }
};

 // ============================================
 // RECIPE SEARCH TERMS
 // ============================================

const RECIPE_SEARCH_TERMS = {
  pasta: [
    "pasta",
    "spaghetti",
    "penne",
    "macaroni",
    "lasagna",
    "linguine",
    "fettuccine",
    "alfredo"
  ],

  noodles: [
    "noodles",
    "noodle",
    "ramen",
    "udon",
    "lo mein",
    "chow mein",
    "stir fry"
  ],

  chicken: [
    "chicken"
  ],

  beef: [
    "beef"
  ],

  rice: [
    "rice",
    "risotto"
  ],

  potatoes: [
    "potato",
    "potatoes"
  ],

  seafood: [
    "salmon",
    "shrimp",
    "prawns",
    "fish"
  ],

  vegetarian: [
    "vegetarian",
    "vegetable",
    "lentil",
    "chickpea"
  ]
};
