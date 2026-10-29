

const inventory = [
  "chicken",
  "rice",
  "broccoli",
  "pasta",
  "tomatoes",
  "cheese",
  "eggs"
];

const recipes = [
  {
    name: "Chicken and Rice Bowl",
    ingredients: ["chicken", "rice", "broccoli"]
  },
  {
    name: "Tomato Pasta",
    ingredients: ["pasta", "tomatoes", "cheese"]
  },
  {
    name: "Egg Fried Rice",
    ingredients: ["eggs", "rice", "broccoli"]
  }
];

// Show the grocery store inventory
const inventoryList = document.getElementById("inventory-list");

inventory.forEach(item => {
  const li = document.createElement("li");
  li.textContent = item;
  inventoryList.appendChild(li);
});

// Find recipes using only available ingredients
function findRecipes() {
  const results = document.getElementById("recipe-results");
  results.innerHTML = "";

  const matchingRecipes = recipes.filter(recipe =>
    recipe.ingredients.every(ingredient =>
      inventory.includes(ingredient)
    )
  );

  if (matchingRecipes.length === 0) {
    results.textContent = "No matching recipes found.";
    return;
  }

  matchingRecipes.forEach(recipe => {
    const card = document.createElement("div");
    card.className = "recipe-card";

    const heading = document.createElement("h3");
    heading.textContent = recipe.name;

    const ingredients = document.createElement("p");
    ingredients.textContent =
      "Ingredients: " + recipe.ingredients.join(", ");

    card.appendChild(heading);
    card.appendChild(ingredients);
    results.appendChild(card);
  });
}

document.getElementById("find-recipes")
  .addEventListener("click", findRecipes);
