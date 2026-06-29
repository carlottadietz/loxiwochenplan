const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MEALS = ["Fruehstueck", "Mittag", "Abendessen"];
const POLLING_INTERVAL_MS = 15000;

function createEmptyWeekPlan() {
  return Object.fromEntries(
    DAYS.map((day) => [
      day,
      Object.fromEntries(MEALS.map((meal) => [meal, { recipeId: null, servings: null }]))
    ])
  );
}

let state = {
  recipes: [],
  weekPlan: createEmptyWeekPlan(),
  shoppingList: []
};
let draggedRecipeId = null;

const recipeForm = document.querySelector("#recipe-form");
const recipeNameInput = document.querySelector("#recipe-name");
const recipeServingsInput = document.querySelector("#recipe-servings");
const recipeIngredientsInput = document.querySelector("#recipe-ingredients");
const recipeLibrary = document.querySelector("#recipe-library");
const weekBoard = document.querySelector("#week-board");
const shoppingList = document.querySelector("#shopping-list");
const resetWeekButton = document.querySelector("#reset-week");
const copyShoppingListButton = document.querySelector("#copy-shopping-list");
const refreshDataButton = document.querySelector("#refresh-data");
const syncStatus = document.querySelector("#sync-status");
const recipeCardTemplate = document.querySelector("#recipe-card-template");
const dayCardTemplate = document.querySelector("#day-card-template");

recipeForm.addEventListener("submit", handleRecipeSubmit);
resetWeekButton.addEventListener("click", resetWeek);
copyShoppingListButton.addEventListener("click", copyShoppingList);
refreshDataButton.addEventListener("click", () => syncState({ announce: true }));

initialize();

async function initialize() {
  try {
    const nextState = await apiFetch("/api/state");
    replaceState(nextState);
    updateSyncStatus("Gemeinsamer Plan ist synchronisiert.");
  } catch {
    updateSyncStatus("Server nicht erreichbar. Bitte spaeter erneut laden.");
  }

  render();
  window.setInterval(() => {
    syncState();
  }, POLLING_INTERVAL_MS);
}

async function syncState(options = {}) {
  try {
    const nextState = await apiFetch("/api/state");
    replaceState(nextState);
    render();
    if (options.announce) {
      updateSyncStatus("Plan erfolgreich neu geladen.");
    }
  } catch {
    if (options.announce) {
      updateSyncStatus("Synchronisierung fehlgeschlagen.");
    }
  }
}

async function handleRecipeSubmit(event) {
  event.preventDefault();

  const name = recipeNameInput.value.trim();
  const baseServings = Number(recipeServingsInput.value);
  const ingredients = recipeIngredientsInput.value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!name || ingredients.length === 0 || baseServings < 1) {
    updateSyncStatus("Bitte Rezeptname, Personenanzahl und Zutaten angeben.");
    return;
  }

  try {
    const nextState = await apiFetch("/api/recipes", {
      method: "POST",
      body: JSON.stringify({ name, baseServings, ingredients })
    });
    replaceState(nextState);
    recipeForm.reset();
    recipeServingsInput.value = 2;
    updateSyncStatus("Rezept fuer alle gespeichert.");
    render();
  } catch {
    updateSyncStatus("Rezept konnte nicht gespeichert werden.");
  }
}

async function resetWeek() {
  try {
    const nextState = await apiFetch("/api/week-plan/reset", { method: "POST" });
    replaceState(nextState);
    updateSyncStatus("Woche fuer alle geleert.");
    render();
  } catch {
    updateSyncStatus("Woche konnte nicht geleert werden.");
  }
}

async function copyShoppingList() {
  const items = state.shoppingList.map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.label}`);
  if (items.length === 0) {
    return;
  }

  try {
    await navigator.clipboard.writeText(items.join("\n"));
    copyShoppingListButton.textContent = "Kopiert";
    window.setTimeout(() => {
      copyShoppingListButton.textContent = "Liste kopieren";
    }, 1600);
  } catch {
    copyShoppingListButton.textContent = "Kopieren nicht moeglich";
  }
}

function render() {
  renderRecipeLibrary();
  renderWeekBoard();
  renderShoppingList();
}

function renderRecipeLibrary() {
  recipeLibrary.replaceChildren();

  if (state.recipes.length === 0) {
    recipeLibrary.append(createEmptyState("Noch keine Rezepte angelegt."));
    return;
  }

  state.recipes.forEach((recipe) => {
    const card = recipeCardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.recipeId = recipe.id;
    card.querySelector("h3").textContent = recipe.name;
    card.querySelector(".recipe-servings").textContent = `Basis fuer ${recipe.baseServings} Personen`;
    card.querySelector(".ingredient-preview").textContent = recipe.ingredients.join(" • ");

    card.addEventListener("dragstart", (event) => {
      draggedRecipeId = recipe.id;
      event.dataTransfer?.setData("text/plain", recipe.id);
      event.dataTransfer?.setData("application/x-recipe-id", recipe.id);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
      card.classList.add("dragging");
    });

    card.addEventListener("dragend", () => {
      draggedRecipeId = null;
      card.classList.remove("dragging");
    });

    card.querySelector(".delete-recipe").addEventListener("click", () => {
      deleteRecipe(recipe.id);
    });

    recipeLibrary.append(card);
  });
}

function renderWeekBoard() {
  weekBoard.replaceChildren();

  DAYS.forEach((day) => {
    const dayCard = dayCardTemplate.content.firstElementChild.cloneNode(true);
    dayCard.querySelector("h3").textContent = day;
    const mealsContainer = dayCard.querySelector(".meal-slots");

    MEALS.forEach((meal) => {
      mealsContainer.append(createMealSlot(day, meal));
    });

    weekBoard.append(dayCard);
  });
}

function createMealSlot(day, meal) {
  const mealSlot = document.createElement("section");
  mealSlot.className = "meal-slot";

  const heading = document.createElement("div");
  heading.className = "meal-slot-header";
  const title = document.createElement("h4");
  title.textContent = meal;
  const subtitle = document.createElement("span");
  subtitle.className = "day-subtitle";
  subtitle.textContent = "Rezept hier ablegen";
  heading.append(title, subtitle);

  const dropZone = document.createElement("div");
  dropZone.className = "drop-zone";
  dropZone.dataset.day = day;
  dropZone.dataset.meal = meal;

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");

    const droppedRecipeId =
      event.dataTransfer?.getData("application/x-recipe-id") ||
      event.dataTransfer?.getData("text/plain") ||
      draggedRecipeId;

    if (!droppedRecipeId) {
      return;
    }

    const recipe = state.recipes.find((entry) => entry.id === droppedRecipeId);
    if (!recipe) {
      return;
    }

    try {
      const nextState = await apiFetch("/api/week-plan", {
        method: "PUT",
        body: JSON.stringify({
          day,
          meal,
          recipeId: droppedRecipeId,
          servings: recipe.baseServings
        })
      });
      replaceState(nextState);
      updateSyncStatus(`${day} ${meal} gespeichert.`);
      render();
    } catch {
      updateSyncStatus(`${day} ${meal} konnte nicht gespeichert werden.`);
    }
  });

  const plannedEntry = state.weekPlan[day]?.[meal] || { recipeId: null, servings: null };
  const plannedRecipe = state.recipes.find((recipe) => recipe.id === plannedEntry.recipeId);

  if (!plannedRecipe) {
    dropZone.append(createEmptyState("Noch kein Rezept eingeplant."));
  } else {
    dropZone.append(createPlannedRecipeCard(day, meal, plannedRecipe, plannedEntry.servings));
  }

  mealSlot.append(heading, dropZone);
  return mealSlot;
}

function createPlannedRecipeCard(day, meal, recipe, servings) {
  const plannedCard = document.createElement("article");
  plannedCard.className = "planned-recipe";

  const content = document.createElement("div");
  const title = document.createElement("h4");
  title.textContent = recipe.name;
  const meta = document.createElement("p");
  meta.className = "ingredient-preview";
  meta.textContent = `${servings} Personen • Basis ${recipe.baseServings}`;
  const ingredients = document.createElement("p");
  ingredients.className = "ingredient-preview";
  ingredients.textContent = recipe.ingredients.join(" • ");
  content.append(title, meta, ingredients);

  const actions = document.createElement("div");
  actions.className = "planned-actions";

  const servingControls = document.createElement("div");
  servingControls.className = "serving-controls";

  const decreaseButton = document.createElement("button");
  decreaseButton.type = "button";
  decreaseButton.className = "ghost-button serving-button";
  decreaseButton.textContent = "-";
  decreaseButton.disabled = servings <= 1;
  decreaseButton.addEventListener("click", () => {
    updatePlannedServings(day, meal, recipe.id, servings - 1);
  });

  const servingValue = document.createElement("span");
  servingValue.className = "serving-value";
  servingValue.textContent = `${servings} Pers.`;

  const increaseButton = document.createElement("button");
  increaseButton.type = "button";
  increaseButton.className = "ghost-button serving-button";
  increaseButton.textContent = "+";
  increaseButton.addEventListener("click", () => {
    updatePlannedServings(day, meal, recipe.id, servings + 1);
  });

  servingControls.append(decreaseButton, servingValue, increaseButton);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "ghost-button";
  clearButton.textContent = "Entfernen";
  clearButton.addEventListener("click", async () => {
    try {
      const nextState = await apiFetch("/api/week-plan", {
        method: "PUT",
        body: JSON.stringify({ day, meal, recipeId: null, servings: null })
      });
      replaceState(nextState);
      updateSyncStatus(`${day} ${meal} wurde geleert.`);
      render();
    } catch {
      updateSyncStatus(`${day} ${meal} konnte nicht aktualisiert werden.`);
    }
  });

  actions.append(servingControls, clearButton);
  plannedCard.append(content, actions);
  return plannedCard;
}

async function updatePlannedServings(day, meal, recipeId, servings) {
  if (servings < 1) {
    return;
  }

  try {
    const nextState = await apiFetch("/api/week-plan", {
      method: "PUT",
      body: JSON.stringify({ day, meal, recipeId, servings })
    });
    replaceState(nextState);
    updateSyncStatus(`${day} ${meal} auf ${servings} Personen gesetzt.`);
    render();
  } catch {
    updateSyncStatus("Personenzahl konnte nicht aktualisiert werden.");
  }
}

function renderShoppingList() {
  shoppingList.replaceChildren();

  if (state.shoppingList.length === 0) {
    shoppingList.append(createEmptyState("Plane Rezepte ein, damit hier deine Einkaufsliste erscheint."));
    return;
  }

  state.shoppingList.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.className = "shopping-item";

    const label = document.createElement("label");
    label.className = "shopping-item-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.checked;
    checkbox.addEventListener("change", async () => {
      try {
        const nextState = await apiFetch("/api/shopping-list", {
          method: "PUT",
          body: JSON.stringify({ itemId: item.id, checked: checkbox.checked })
        });
        replaceState(nextState);
        render();
      } catch {
        checkbox.checked = !checkbox.checked;
        updateSyncStatus("Einkaufslisten-Eintrag konnte nicht gespeichert werden.");
      }
    });

    const text = document.createElement("span");
    text.textContent = item.label;
    if (item.checked) {
      text.classList.add("shopping-item-checked");
    }

    label.append(checkbox, text);
    listItem.append(label);
    shoppingList.append(listItem);
  });
}

async function deleteRecipe(recipeId) {
  try {
    const nextState = await apiFetch(`/api/recipes/${recipeId}`, { method: "DELETE" });
    replaceState(nextState);
    updateSyncStatus("Rezept fuer alle geloescht.");
    render();
  } catch {
    updateSyncStatus("Rezept konnte nicht geloescht werden.");
  }
}

function createEmptyState(text) {
  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";
  emptyState.textContent = text;
  return emptyState;
}

function replaceState(nextState) {
  state = {
    recipes: Array.isArray(nextState.recipes) ? nextState.recipes : [],
    weekPlan: createEmptyWeekPlan(),
    shoppingList: Array.isArray(nextState.shoppingList) ? nextState.shoppingList : []
  };

  DAYS.forEach((day) => {
    MEALS.forEach((meal) => {
      const entry = nextState.weekPlan?.[day]?.[meal];
      state.weekPlan[day][meal] = {
        recipeId: entry?.recipeId || null,
        servings: entry?.servings || null
      };
    });
  });
}

function updateSyncStatus(message) {
  syncStatus.textContent = message;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}