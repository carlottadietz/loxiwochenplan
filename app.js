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

const recipeForm = document.querySelector("#recipe-form");
const recipeNameInput = document.querySelector("#recipe-name");
const recipeServingsInput = document.querySelector("#recipe-servings");
const recipeIngredientsInput = document.querySelector("#recipe-ingredients");
const recipeTagInputs = Array.from(document.querySelectorAll('input[name="recipe-tags"]'));
const navTabs = Array.from(document.querySelectorAll(".nav-tab"));
const pageViews = Array.from(document.querySelectorAll(".page-view"));
const recipeLibrary = document.querySelector("#recipe-library");
const weekBoard = document.querySelector("#week-board");
const shoppingList = document.querySelector("#shopping-list");
const resetWeekButton = document.querySelector("#reset-week");
const copyShoppingListButton = document.querySelector("#copy-shopping-list");
const refreshDataButton = document.querySelector("#refresh-data");
const syncStatus = document.querySelector("#sync-status");
const recipeModal = document.querySelector("#recipe-modal");
const openRecipeModalButton = document.querySelector("#open-recipe-modal");
const openRecipeModalSecondaryButton = document.querySelector("#open-recipe-modal-secondary");
const closeRecipeModalButton = document.querySelector("#close-recipe-modal");
const recipeCardTemplate = document.querySelector("#recipe-card-template");
const dayCardTemplate = document.querySelector("#day-card-template");

recipeForm.addEventListener("submit", handleRecipeSubmit);
resetWeekButton.addEventListener("click", resetWeek);
copyShoppingListButton.addEventListener("click", copyShoppingList);
refreshDataButton.addEventListener("click", () => syncState({ announce: true }));
openRecipeModalButton.addEventListener("click", openRecipeModal);
openRecipeModalSecondaryButton.addEventListener("click", openRecipeModal);
closeRecipeModalButton.addEventListener("click", closeRecipeModal);
recipeModal.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.closeModal === "true") {
    closeRecipeModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !recipeModal.hidden) {
    closeRecipeModal();
  }
});
navTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActivePage(tab.dataset.page || "planner");
  });
});

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
  const tags = recipeTagInputs.filter((input) => input.checked).map((input) => input.value);
  const ingredients = recipeIngredientsInput.value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!name || ingredients.length === 0 || baseServings < 1 || tags.length === 0) {
    updateSyncStatus("Bitte Rezeptname, Personenanzahl, Meal-Labels und Zutaten angeben.");
    return;
  }

  try {
    const nextState = await apiFetch("/api/recipes", {
      method: "POST",
      body: JSON.stringify({ name, baseServings, tags, ingredients })
    });
    replaceState(nextState);
    recipeForm.reset();
    recipeServingsInput.value = 2;
    recipeTagInputs.forEach((input) => {
      input.checked = input.value === "Mittag" || input.value === "Abendessen";
    });
    closeRecipeModal();
    setActivePage("library");
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
    const tagsContainer = card.querySelector(".recipe-tags");
    const recipeTags = Array.isArray(recipe.tags) && recipe.tags.length > 0 ? recipe.tags : MEALS;
    recipeTags.forEach((tag) => {
      const tagElement = document.createElement("span");
      tagElement.className = "recipe-tag";
      tagElement.textContent = tag;
      tagsContainer.append(tagElement);
    });
    card.querySelector(".ingredient-preview").textContent = recipe.ingredients.join(" • ");
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
    dayCard.querySelector(".day-card-subtitle").textContent = `${MEALS.length} Mahlzeiten im Blick`;
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
  subtitle.textContent = "Rezept auswaehlen";
  heading.append(title, subtitle);

  const slotBody = document.createElement("div");
  slotBody.className = "drop-zone";

  const plannedEntry = state.weekPlan[day]?.[meal] || { recipeId: null, servings: null };
  const plannedRecipe = state.recipes.find((recipe) => recipe.id === plannedEntry.recipeId);
  const availableRecipes = state.recipes.filter((recipe) => {
    const recipeTags = Array.isArray(recipe.tags) && recipe.tags.length > 0 ? recipe.tags : MEALS;
    return recipeTags.includes(meal);
  });

  const select = document.createElement("select");
  select.className = "meal-select";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Kein Rezept";
  select.append(emptyOption);

  availableRecipes.forEach((recipe) => {
    const option = document.createElement("option");
    option.value = recipe.id;
    option.textContent = recipe.name;
    select.append(option);
  });

  select.value = plannedEntry.recipeId || "";
  select.disabled = availableRecipes.length === 0;
  select.addEventListener("change", async () => {
    const nextRecipeId = select.value || null;
    const nextRecipe = state.recipes.find((recipe) => recipe.id === nextRecipeId);

    try {
      const nextState = await apiFetch("/api/week-plan", {
        method: "PUT",
        body: JSON.stringify({
          day,
          meal,
          recipeId: nextRecipeId,
          servings: nextRecipe ? nextRecipe.baseServings : null
        })
      });
      replaceState(nextState);
      updateSyncStatus(nextRecipeId ? `${day} ${meal} gespeichert.` : `${day} ${meal} geleert.`);
      render();
    } catch {
      updateSyncStatus(`${day} ${meal} konnte nicht gespeichert werden.`);
    }
  });

  slotBody.append(select);

  if (!plannedRecipe) {
    slotBody.append(
      createEmptyState(
        availableRecipes.length === 0
          ? "Kein Rezept mit passendem Label vorhanden."
          : "Noch kein Rezept eingeplant."
      )
    );
  } else {
    slotBody.append(createPlannedRecipeCard(day, meal, plannedRecipe, plannedEntry.servings));
  }

  mealSlot.append(heading, slotBody);
  return mealSlot;
}

function createPlannedRecipeCard(day, meal, recipe, servings) {
  const plannedCard = document.createElement("article");
  plannedCard.className = "planned-recipe";

  const content = document.createElement("div");
  const title = document.createElement("h4");
  title.className = "planned-recipe-title";
  title.textContent = recipe.name;
  const meta = document.createElement("p");
  meta.className = "ingredient-preview";
  meta.textContent = `${servings} Personen • Basis ${recipe.baseServings}`;
  content.append(title, meta);

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
    recipes: Array.isArray(nextState.recipes)
      ? nextState.recipes.map((recipe) => ({
          ...recipe,
          tags: Array.isArray(recipe.tags) && recipe.tags.length > 0 ? recipe.tags : [...MEALS]
        }))
      : [],
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

function openRecipeModal() {
  recipeModal.hidden = false;
  recipeNameInput.focus();
}

function closeRecipeModal() {
  recipeModal.hidden = true;
}

function setActivePage(page) {
  navTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.page === page);
  });
  pageViews.forEach((view) => {
    view.classList.toggle("is-active", view.dataset.pageView === page);
  });
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