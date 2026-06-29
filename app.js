const DAYS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag"
];

const POLLING_INTERVAL_MS = 15000;

const emptyWeekPlan = {
  Montag: null,
  Dienstag: null,
  Mittwoch: null,
  Donnerstag: null,
  Freitag: null,
  Samstag: null,
  Sonntag: null
};

let state = {
  recipes: [],
  weekPlan: { ...emptyWeekPlan }
};
let draggedRecipeId = null;

const recipeForm = document.querySelector("#recipe-form");
const recipeNameInput = document.querySelector("#recipe-name");
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
refreshDataButton.addEventListener("click", () => {
  syncState({ announce: true });
});

initialize();

async function initialize() {
  try {
    const nextState = await apiFetch("/api/state");
    replaceState(nextState);
    updateSyncStatus("Gemeinsamer Plan ist synchronisiert.");
    render();
  } catch {
    updateSyncStatus("Server nicht erreichbar. Bitte spaeter erneut laden.");
    render();
  }

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
  const ingredients = recipeIngredientsInput.value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!name || ingredients.length === 0) {
    return;
  }

  try {
    const nextState = await apiFetch("/api/recipes", {
      method: "POST",
      body: JSON.stringify({ name, ingredients })
    });
    replaceState(nextState);
    recipeForm.reset();
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
  const items = buildShoppingList();
  const text = items.join("\n");

  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
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
    const dropZone = dayCard.querySelector(".drop-zone");

    dayCard.querySelector("h3").textContent = day;

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

      try {
        const nextState = await apiFetch("/api/week-plan", {
          method: "PUT",
          body: JSON.stringify({ day, recipeId: droppedRecipeId })
        });
        replaceState(nextState);
        updateSyncStatus(`Plan fuer ${day} gespeichert.`);
        render();
      } catch {
        updateSyncStatus(`Plan fuer ${day} konnte nicht gespeichert werden.`);
      }
    });

    const plannedRecipeId = state.weekPlan[day];
    const plannedRecipe = state.recipes.find((recipe) => recipe.id === plannedRecipeId);

    if (!plannedRecipe) {
      dropZone.append(createEmptyState("Noch kein Rezept eingeplant."));
    } else {
      const plannedCard = document.createElement("article");
      plannedCard.className = "planned-recipe";

      const content = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = plannedRecipe.name;
      const ingredients = document.createElement("p");
      ingredients.className = "ingredient-preview";
      ingredients.textContent = plannedRecipe.ingredients.join(" • ");
      content.append(title, ingredients);

      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "ghost-button";
      clearButton.textContent = "Entfernen";
      clearButton.addEventListener("click", async () => {
        try {
          const nextState = await apiFetch("/api/week-plan", {
            method: "PUT",
            body: JSON.stringify({ day, recipeId: null })
          });
          replaceState(nextState);
          updateSyncStatus(`${day} wurde geleert.`);
          render();
        } catch {
          updateSyncStatus(`${day} konnte nicht aktualisiert werden.`);
        }
      });

      plannedCard.append(content, clearButton);
      dropZone.append(plannedCard);
    }

    weekBoard.append(dayCard);
  });
}

function renderShoppingList() {
  shoppingList.replaceChildren();

  const items = buildShoppingList();

  if (items.length === 0) {
    shoppingList.append(createEmptyState("Plane Rezepte ein, damit hier deine Einkaufsliste erscheint."));
    return;
  }

  items.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.textContent = item;
    shoppingList.append(listItem);
  });
}

function buildShoppingList() {
  const ingredientMap = new Map();

  Object.values(state.weekPlan)
    .filter(Boolean)
    .forEach((recipeId) => {
      const recipe = state.recipes.find((entry) => entry.id === recipeId);

      if (!recipe) {
        return;
      }

      recipe.ingredients.forEach((ingredient) => {
        const key = ingredient.toLowerCase();
        ingredientMap.set(key, ingredientMap.has(key) ? `${ingredientMap.get(key)}, ${ingredient}` : ingredient);
      });
    });

  return Array.from(ingredientMap.values());
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
    weekPlan: { ...emptyWeekPlan, ...(nextState.weekPlan || {}) }
  };
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