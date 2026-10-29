

const inventory = [
  "avocado",
  "banana",
  "lemon",
  "lime",
  "mango",
  "pineapple",
  "milk",
  "sour cream",
  "yogurt",
  "carrot",
  "garlic",
  "ginger",
  "onion",
  "potato",
  "tomato",
  "zucchini",
  "bell pepper",
  "chicken",
  "rice",
  "beef",
  "pasta"
];

const API = "https://www.themealdb.com/api/json/v1/1";

// Display inventory
const inventoryList = document.getElementById("inventory-list");

inventory.forEach(item => {
  const li = document.createElement("li");
  li.textContent = item;
  inventoryList.appendChild(li);
});

// Get ingredients from an online recipe
function getIngredients(meal) {
  const ingredients = [];

  for (let i = 1; i <= 20; i++) {
    const ingredient = meal[`strIngredient${i}`];

    if (ingredient && ingredient.trim()) {
      ingredients.push(ingredient.trim().toLowerCase());
    }
  }

  return ingredients;
}

// Find recipes using a random grocery ingredient
async function findRecipes() {
  const results = document.getElementById("recipe-results");
  const button = document.getElementById("find-recipes");

  button.disabled = true;

  try {
    // Randomly select an ingredient
    const randomIndex = Math.floor(Math.random() * inventory.length);
    const selectedIngredient = inventory[randomIndex];

    results.textContent =
      `Searching for recipes with ${selectedIngredient}...`;

    // Search TheMealDB
    const response = await fetch(
      `${API}/filter.php?i=${encodeURIComponent(selectedIngredient)}`
    );

    if (!response.ok) {
      throw new Error("Recipe search failed");
    }

    const data = await response.json();
    const candidates = (data.meals || []).slice(0, 15);

    // Get full recipe details
    const meals = await Promise.all(
      candidates.map(async candidate => {
        const response = await fetch(
          `${API}/lookup.php?i=${candidate.idMeal}`
        );

        if (!response.ok) {
          throw new Error("Could not load recipe");
        }

        const data = await response.json();
        return data.meals?.[0];
      })
    );

    // Compare recipe ingredients to inventory
    const matches = meals
      .filter(Boolean)
      .map(meal => {
        const ingredients = getIngredients(meal);

        const missing = ingredients.filter(
          item => !inventory.includes(item)
        );

        return { meal, missing };
      })
      .sort((a, b) => a.missing.length - b.missing.length)
      .slice(0, 3);

    results.innerHTML = "";

    if (matches.length === 0) {
      results.textContent =
        `No recipes found for ${selectedIngredient}. Try again!`;
      return;
    }

    // Display matching recipes
    matches.forEach(({ meal, missing }) => {
      const card = document.createElement("div");
      card.className = "recipe-card";

      const title = document.createElement("h3");
      title.textContent = meal.strMeal;

      const image = document.createElement("img");
      image.src = meal.strMealThumb;
      image.alt = meal.strMeal;
      image.style.width = "150px";

      const status = document.createElement("p");
      status.textContent = missing.length === 0
        ? "All ingredients available!"
        : "Missing: " + missing.join(", ");

      const link = document.createElement("a");
      link.href =
        `https://www.themealdb.com/meal/${meal.idMeal}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "View Recipe";

      card.append(title, image, status, link);
      results.appendChild(card);
    });

  } catch (error) {
    console.error(error);
    results.textContent =
      "Could not load recipes. Please try again.";
  } finally {
    button.disabled = false;
  }
}

// Connect button to function
document.getElementById("find-recipes")
  .addEventListener("click", findRecipes);


function resetRecipes() {
  const results = document.getElementById("recipe-results");

  // Clear previous recipe results
  results.innerHTML = "";

  // Restore the original message
  results.textContent = "Click the button to find recipes.";
}

// Connect the Reset button
document.getElementById("reset-button")
  .addEventListener("click", resetRecipes);
