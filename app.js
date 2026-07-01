const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MEALS = ["Fruehstueck", "Mittag", "Abendessen"];
const POLLING_INTERVAL_MS = 15000;
const ALL_DAYS_KEY = "__all_days__";
const WEEKLY_CATEGORIES = [
  {
    key: "snacks",
    containerId: "#snack-options",
    inputId: "#snack-input",
    suggestionsId: "#snack-suggestions",
    label: "Snacks"
  },
  {
    key: "household",
    containerId: "#household-options",
    inputId: "#household-input",
    suggestionsId: "#household-suggestions",
    label: "Putzmittel"
  },
  {
    key: "pantry",
    containerId: "#pantry-options",
    inputId: "#pantry-input",
    suggestionsId: "#pantry-suggestions",
    label: "Vorrat"
  }
];

function getCurrentDayLabel() {
  const dayIndex = (new Date().getDay() + 6) % 7;
  return DAYS[dayIndex] || DAYS[0];
}

function displayMealLabel(meal) {
  if (meal === "Fruehstueck") {
    return "Frühstück";
  }
  return meal;
}

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
  shoppingList: [],
  currentWeekStart: null,
  availableWeeks: [],
  weeklyOptions: {
    snacks: [],
    household: [],
    pantry: []
  }
};
let selectedDay = getCurrentDayLabel();
let editingRecipeId = null;
let selectedRecipeTags = new Set(["Mittag", "Abendessen"]);

const recipeForm = document.querySelector("#recipe-form");
const recipeNameInput = document.querySelector("#recipe-name");
const recipeServingsInput = document.querySelector("#recipe-servings");
const recipeTagButtons = Array.from(document.querySelectorAll(".tag-toggle"));
const ingredientList = document.querySelector("#ingredient-list");
const addIngredientButton = document.querySelector("#add-ingredient-button");
const navTabs = Array.from(document.querySelectorAll(".nav-tab"));
const pageViews = Array.from(document.querySelectorAll(".page-view"));
const daySelector = document.querySelector("#day-selector");
const dayFlowStatus = document.querySelector("#day-flow-status");
const prevDayButton = document.querySelector("#prev-day");
const nextDayButton = document.querySelector("#next-day");
const nextOpenDayButton = document.querySelector("#next-open-day");
const goTodayButton = document.querySelector("#go-today");
const showAllDaysButton = document.querySelector("#show-all-days");
const dayProgressFill = document.querySelector("#day-progress-fill");
const dayProgressText = document.querySelector("#day-progress-text");
const weeklyAddForms = Array.from(document.querySelectorAll(".extra-add-form"));
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
const recipeModalTitle = document.querySelector("#recipe-modal-title");
const recipeSubmitButton = document.querySelector("#recipe-submit-button");
const recipeCardTemplate = document.querySelector("#recipe-card-template");
const dayCardTemplate = document.querySelector("#day-card-template");

recipeForm.addEventListener("submit", handleRecipeSubmit);
resetWeekButton.addEventListener("click", resetWeek);
copyShoppingListButton.addEventListener("click", copyShoppingList);
refreshDataButton.addEventListener("click", () => syncState({ announce: true }));
addIngredientButton.addEventListener("click", () => {
  ingredientList.append(createIngredientRow());
});
openRecipeModalButton.addEventListener("click", openRecipeModal);
openRecipeModalSecondaryButton.addEventListener("click", openRecipeModal);
closeRecipeModalButton.addEventListener("click", closeRecipeModal);
prevDayButton.addEventListener("click", () => stepSelectedDay(-1));
nextDayButton.addEventListener("click", () => stepSelectedDay(1));
nextOpenDayButton.addEventListener("click", jumpToNextOpenDay);
goTodayButton.addEventListener("click", () => {
  selectedDay = getCurrentDayLabel();
  renderPlannerNavigation();
  renderWeekBoard();
});
showAllDaysButton.addEventListener("click", () => {
  selectedDay = ALL_DAYS_KEY;
  renderPlannerNavigation();
  renderWeekBoard();
});
weeklyAddForms.forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const category = form.dataset.category;
    const input = form.querySelector("input");
    if (!category || !(input instanceof HTMLInputElement)) {
      return;
    }
    createWeeklyOption(category, input.value.trim(), input);
  });
});
daySelector.addEventListener("click", (event) => {
  const button = event.target instanceof HTMLElement ? event.target.closest("button[data-day]") : null;
  if (!button) {
    return;
  }

  selectedDay = button.dataset.day || getCurrentDayLabel();
  renderPlannerNavigation();
  renderWeekBoard();
});
recipeTagButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tag = button.dataset.tag;
    if (!tag) {
      return;
    }
    if (selectedRecipeTags.has(tag)) {
      selectedRecipeTags.delete(tag);
    } else {
      selectedRecipeTags.add(tag);
    }
    renderRecipeTagButtons();
  });
});
recipeModal.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.closeModal === "true") {
    closeRecipeModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !recipeModal.hidden) {
    closeRecipeModal();
  }

  if (recipeModal.hidden && isPlannerActive()) {
    if (event.key === "ArrowLeft") {
      stepSelectedDay(-1);
    }
    if (event.key === "ArrowRight") {
      stepSelectedDay(1);
    }
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
    const nextState = await apiFetch(withWeek("/api/state"));
    replaceState(nextState);
    updateSyncStatus("Gemeinsamer Plan ist synchronisiert.");
  } catch {
    updateSyncStatus("Server nicht erreichbar. Bitte später erneut laden.");
  }

  render();
  window.setInterval(() => {
    syncState();
  }, POLLING_INTERVAL_MS);
}

async function syncState(options = {}) {
  try {
    const nextState = await apiFetch(withWeek("/api/state"));
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
  const tags = Array.from(selectedRecipeTags);
  const ingredients = collectIngredients();

  if (!name || ingredients.length === 0 || baseServings < 1 || tags.length === 0) {
    updateSyncStatus("Bitte Rezeptname, Personenanzahl, Meal-Labels und Zutaten angeben.");
    return;
  }

  const invalidIngredient = ingredients.find((ingredient) => !hasRequiredIngredientParts(ingredient));
  if (invalidIngredient) {
    updateSyncStatus("Bitte jede Zutat mit Menge, Einheit und Name angeben (z. B. 2 kg Kartoffeln).");
    return;
  }

  try {
    const isEdit = Boolean(editingRecipeId);
    const nextState = await apiFetch(withWeek(isEdit ? `/api/recipes/${editingRecipeId}` : "/api/recipes"), {
      method: isEdit ? "PUT" : "POST",
      body: JSON.stringify({ name, baseServings, tags, ingredients })
    });
    replaceState(nextState);
    resetRecipeForm();
    closeRecipeModal();
    setActivePage("library");
    updateSyncStatus(isEdit ? "Rezept wurde aktualisiert." : "Rezept für alle gespeichert.");
    render();
  } catch {
    updateSyncStatus("Rezept konnte nicht gespeichert werden.");
  }
}

async function resetWeek() {
  try {
    const nextState = await apiFetch(withWeek("/api/week-plan/reset"), {
      method: "POST"
    });
    replaceState(nextState);
    updateSyncStatus("Woche für alle geleert.");
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
    copyShoppingListButton.textContent = "Kopieren nicht möglich";
  }
}

function render() {
  renderPlannerNavigation();
  renderRecipeLibrary();
  renderWeekBoard();
  renderWeeklyOptions();
  renderShoppingList();
}

function renderPlannerNavigation() {
  renderDaySelector();
  updateDayFlowStatus();
}

function renderDaySelector() {
  daySelector.replaceChildren();

  DAYS.forEach((day) => {
    const dayButton = document.createElement("button");
    dayButton.type = "button";
    dayButton.className = "day-chip";
    dayButton.dataset.day = day;
    dayButton.textContent = day;

    if (selectedDay === day) {
      dayButton.classList.add("is-active");
    }
    if (day === getCurrentDayLabel()) {
      dayButton.classList.add("is-today");
    }

    daySelector.append(dayButton);
  });
}

function updateDayFlowStatus() {
  const totalPlannedMeals = DAYS.reduce((sum, day) => sum + countPlannedMealsForDay(day), 0);
  const totalMeals = DAYS.length * MEALS.length;

  if (selectedDay === ALL_DAYS_KEY) {
    dayFlowStatus.textContent = `Alle Tage im Überblick (${totalPlannedMeals}/${totalMeals} Mahlzeiten geplant)`;
    prevDayButton.disabled = false;
    nextDayButton.disabled = false;
    nextOpenDayButton.disabled = totalPlannedMeals >= totalMeals;
    updateDayProgress(totalPlannedMeals, totalMeals);
    dayProgressText.textContent = `${totalPlannedMeals} von ${totalMeals} Mahlzeiten geplant`;
    return;
  }

  const dayIndex = DAYS.indexOf(selectedDay);
  const plannedMeals = countPlannedMealsForDay(selectedDay);
  const position = dayIndex >= 0 ? dayIndex + 1 : 1;
  dayFlowStatus.textContent = `${selectedDay} (${position}/${DAYS.length})`;
  prevDayButton.disabled = dayIndex <= 0;
  nextDayButton.disabled = dayIndex === DAYS.length - 1;
  nextOpenDayButton.disabled = findNextOpenDayIndex(dayIndex) === -1;
  updateDayProgress(plannedMeals, MEALS.length);
  dayProgressText.textContent = `${plannedMeals} von ${MEALS.length} Mahlzeiten geplant`;
}

function stepSelectedDay(direction) {
  if (selectedDay === ALL_DAYS_KEY) {
    selectedDay = getCurrentDayLabel();
    renderPlannerNavigation();
    renderWeekBoard();
    return;
  }

  const dayIndex = DAYS.indexOf(selectedDay);
  if (dayIndex < 0) {
    selectedDay = DAYS[0];
    renderPlannerNavigation();
    renderWeekBoard();
    return;
  }

  const nextIndex = dayIndex + direction;
  if (nextIndex < 0 || nextIndex >= DAYS.length) {
    return;
  }

  selectedDay = DAYS[nextIndex];
  renderPlannerNavigation();
  renderWeekBoard();
}

function jumpToNextOpenDay() {
  const startIndex = selectedDay === ALL_DAYS_KEY ? -1 : DAYS.indexOf(selectedDay);
  const nextOpenIndex = findNextOpenDayIndex(startIndex);
  if (nextOpenIndex === -1) {
    updateSyncStatus("Alle Tage sind vollständig geplant.");
    return;
  }

  selectedDay = DAYS[nextOpenIndex];
  renderPlannerNavigation();
  renderWeekBoard();
}

function findNextOpenDayIndex(startIndex) {
  for (let index = startIndex + 1; index < DAYS.length; index += 1) {
    if (countPlannedMealsForDay(DAYS[index]) < MEALS.length) {
      return index;
    }
  }
  return -1;
}

function countPlannedMealsForDay(day) {
  return MEALS.reduce((count, meal) => {
    const entry = state.weekPlan?.[day]?.[meal];
    return entry?.recipeId ? count + 1 : count;
  }, 0);
}

function updateDayProgress(done, total) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  dayProgressFill.style.width = `${Math.round(ratio * 100)}%`;
}

function isPlannerActive() {
  const activeView = pageViews.find((view) => view.classList.contains("is-active"));
  return Boolean(activeView && activeView.dataset.pageView === "planner");
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
    card.querySelector(".recipe-servings").textContent = `Basis für ${recipe.baseServings} Personen`;
    const tagsContainer = card.querySelector(".recipe-tags");
    const recipeTags = Array.isArray(recipe.tags) && recipe.tags.length > 0 ? recipe.tags : MEALS;
    recipeTags.forEach((tag) => {
      const tagElement = document.createElement("span");
      tagElement.className = "recipe-tag";
      tagElement.textContent = displayMealLabel(tag);
      tagsContainer.append(tagElement);
    });
    card.querySelector(".ingredient-preview").textContent = recipe.ingredients.join(" • ");
    card.querySelector(".edit-recipe").addEventListener("click", () => {
      openRecipeModal({ recipe });
    });
    card.querySelector(".delete-recipe").addEventListener("click", () => {
      deleteRecipe(recipe.id);
    });
    recipeLibrary.append(card);
  });
}

function renderWeekBoard() {
  weekBoard.replaceChildren();
  weekBoard.classList.toggle("single-day-mode", selectedDay !== ALL_DAYS_KEY);

  const daysToRender = selectedDay === ALL_DAYS_KEY ? DAYS : [selectedDay];
  const today = getCurrentDayLabel();

  daysToRender.forEach((day) => {
    const dayCard = dayCardTemplate.content.firstElementChild.cloneNode(true);
    dayCard.querySelector("h3").textContent = day;
    dayCard.querySelector(".day-card-subtitle").textContent = selectedDay === ALL_DAYS_KEY
      ? `${MEALS.length} Mahlzeiten im Blick`
      : day === today
        ? "Heute im Fokus"
        : "Tag im Fokus";
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
  title.textContent = displayMealLabel(meal);
  const subtitle = document.createElement("span");
  subtitle.className = "day-subtitle";
  subtitle.textContent = "Rezept auswählen";
  heading.append(title, subtitle);

  const slotBody = document.createElement("div");
  slotBody.className = "drop-zone";

  const plannedEntry = state.weekPlan[day]?.[meal] || { recipeId: null, servings: null };
  const plannedRecipe = state.recipes.find((recipe) => recipe.id === plannedEntry.recipeId);
  const availableRecipeMap = new Map();
  state.recipes.forEach((recipe) => {
    const recipeTags = Array.isArray(recipe.tags) && recipe.tags.length > 0 ? recipe.tags : MEALS;
    if (recipeTags.includes(meal)) {
      availableRecipeMap.set(recipe.id, recipe);
    }
  });
  if (plannedRecipe) {
    availableRecipeMap.set(plannedRecipe.id, plannedRecipe);
  }
  const availableRecipes = Array.from(availableRecipeMap.values());

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
  select.disabled = availableRecipes.length === 0 && !plannedRecipe;
  select.addEventListener("change", async () => {
    const nextRecipeId = select.value || null;
    const nextRecipe = state.recipes.find((recipe) => recipe.id === nextRecipeId);

    try {
      const nextState = await apiFetch("/api/week-plan", {
        method: "PUT",
        body: JSON.stringify({
          weekStart: state.currentWeekStart,
          day,
          meal,
          recipeId: nextRecipeId,
          servings: nextRecipe ? nextRecipe.baseServings : null
        })
      });
      replaceState(nextState);
      updateSyncStatus(nextRecipeId ? `${day} ${displayMealLabel(meal)} gespeichert.` : `${day} ${displayMealLabel(meal)} geleert.`);
      render();
    } catch {
      updateSyncStatus(`${day} ${displayMealLabel(meal)} konnte nicht gespeichert werden.`);
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
        body: JSON.stringify({ weekStart: state.currentWeekStart, day, meal, recipeId: null, servings: null })
      });
      replaceState(nextState);
      updateSyncStatus(`${day} ${displayMealLabel(meal)} wurde geleert.`);
      render();
    } catch {
      updateSyncStatus(`${day} ${displayMealLabel(meal)} konnte nicht aktualisiert werden.`);
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
      body: JSON.stringify({ weekStart: state.currentWeekStart, day, meal, recipeId, servings })
    });
    replaceState(nextState);
    updateSyncStatus(`${day} ${displayMealLabel(meal)} auf ${servings} Personen gesetzt.`);
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

  let previousCategory = null;

  state.shoppingList.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.className = "shopping-item";
    const category = item.category || "sonstiges";
    if (previousCategory !== null && previousCategory !== category) {
      listItem.classList.add("shopping-item-cluster-start");
    }
    previousCategory = category;

    const label = document.createElement("label");
    label.className = "shopping-item-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.checked;
    checkbox.addEventListener("change", async () => {
      try {
        const nextState = await apiFetch("/api/shopping-list", {
        const nextState = await apiFetch(withWeek("/api/shopping-list"), {
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

function renderWeeklyOptions() {
  WEEKLY_CATEGORIES.forEach((category) => {
    const container = document.querySelector(category.containerId);
    const suggestions = document.querySelector(category.suggestionsId);
    if (!container) {
      return;
    }

    container.replaceChildren();
    const options = Array.isArray(state.weeklyOptions?.[category.key])
      ? state.weeklyOptions[category.key]
      : [];

    if (options.length === 0) {
      container.append(createEmptyState("Keine Optionen gefunden."));
      if (suggestions instanceof HTMLElement) {
        suggestions.replaceChildren();
      }
      return;
    }

    if (suggestions instanceof HTMLElement) {
      suggestions.replaceChildren();
      options.forEach((option) => {
        const suggestionOption = document.createElement("option");
        suggestionOption.value = option.label;
        suggestions.append(suggestionOption);
      });
    }

    options.forEach((option) => {
      const itemRow = document.createElement("div");
      itemRow.className = "extra-option-item";

      const itemLabel = document.createElement("label");
      itemLabel.className = "extra-option-label";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(option.selected);
      checkbox.addEventListener("change", () => {
        toggleWeeklyOption(category.key, option.id, checkbox.checked);
      });

      const text = document.createElement("span");
      text.textContent = option.label;

      itemLabel.append(checkbox, text);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "extra-remove-button";
      deleteButton.textContent = "Löschen";
      deleteButton.addEventListener("click", () => {
        deleteWeeklyOption(category.key, option.id);
      });

      itemRow.append(itemLabel, deleteButton);
      container.append(itemRow);
    });
  });
}

async function toggleWeeklyOption(category, itemId, selected) {
  try {
    const nextState = await apiFetch("/api/weekly-options", {
    const nextState = await apiFetch(withWeek("/api/weekly-options"), {
      method: "PUT",
      body: JSON.stringify({ category, itemId, selected })
    });
    replaceState(nextState);
    renderWeeklyOptions();
  } catch {
    updateSyncStatus("Wochenzusatz konnte nicht gespeichert werden.");
  }
}

async function createWeeklyOption(category, label, inputElement) {
  if (!label) {
    return;
  }

  try {
    const nextState = await apiFetch("/api/weekly-options", {
    const nextState = await apiFetch(withWeek("/api/weekly-options"), {
      method: "POST",
      body: JSON.stringify({ category, label })
    });
    replaceState(nextState);
    renderWeeklyOptions();
    if (inputElement instanceof HTMLInputElement) {
      inputElement.value = "";
    }
    updateSyncStatus(`${label} wurde gespeichert und ausgewählt.`);
  } catch {
    updateSyncStatus("Neuer Wochenzusatz konnte nicht gespeichert werden.");
  }
}

async function deleteWeeklyOption(category, itemId) {
  try {
    const nextState = await apiFetch("/api/weekly-options", {
    const nextState = await apiFetch(withWeek("/api/weekly-options"), {
      method: "DELETE",
      body: JSON.stringify({ category, itemId })
    });
    replaceState(nextState);
    renderWeeklyOptions();
    updateSyncStatus("Wochenzusatz wurde gelöscht.");
  } catch {
    updateSyncStatus("Wochenzusatz konnte nicht gelöscht werden.");
  }
}

async function deleteRecipe(recipeId) {
  try {
    const nextState = await apiFetch(withWeek(`/api/recipes/${recipeId}`), { method: "DELETE" });
    replaceState(nextState);
    updateSyncStatus("Rezept für alle gelöscht.");
    render();
  } catch {
    updateSyncStatus("Rezept konnte nicht gelöscht werden.");
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
    shoppingList: Array.isArray(nextState.shoppingList) ? nextState.shoppingList : [],
    currentWeekStart: typeof nextState.currentWeekStart === "string" ? nextState.currentWeekStart : null,
    availableWeeks: Array.isArray(nextState.availableWeeks) ? nextState.availableWeeks : [],
    weeklyOptions: {
      snacks: Array.isArray(nextState.weeklyOptions?.snacks) ? nextState.weeklyOptions.snacks : [],
      household: Array.isArray(nextState.weeklyOptions?.household) ? nextState.weeklyOptions.household : [],
      pantry: Array.isArray(nextState.weeklyOptions?.pantry) ? nextState.weeklyOptions.pantry : []
    }
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

function formatDateKey(dateValue) {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function withWeek(url) {
  const week = state.currentWeekStart;
  if (!week) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}weekStart=${encodeURIComponent(week)}`;
}

function updateSyncStatus(message) {
  syncStatus.textContent = message;
}

function openRecipeModal(options = {}) {
  const recipe = options.recipe;
  if (recipe) {
    editingRecipeId = recipe.id;
    recipeModalTitle.textContent = "Rezept bearbeiten";
    recipeSubmitButton.textContent = "Änderungen speichern";
    recipeNameInput.value = recipe.name;
    recipeServingsInput.value = recipe.baseServings;
    selectedRecipeTags = new Set(Array.isArray(recipe.tags) ? recipe.tags : []);
    renderRecipeTagButtons();
    populateIngredientInputs(Array.isArray(recipe.ingredients) ? recipe.ingredients : []);
  } else {
    resetRecipeForm();
    recipeModalTitle.textContent = "Neues Rezept anlegen";
    recipeSubmitButton.textContent = "Rezept speichern";
    editingRecipeId = null;
  }

  recipeModal.hidden = false;
  recipeNameInput.focus();
}

function closeRecipeModal() {
  recipeModal.hidden = true;
  resetRecipeForm();
  recipeModalTitle.textContent = "Neues Rezept anlegen";
  recipeSubmitButton.textContent = "Rezept speichern";
  editingRecipeId = null;
}

function resetRecipeForm() {
  recipeForm.reset();
  recipeServingsInput.value = 2;
  selectedRecipeTags = new Set(["Mittag", "Abendessen"]);
  renderRecipeTagButtons();
  populateIngredientInputs([""]);
}

function renderRecipeTagButtons() {
  recipeTagButtons.forEach((button) => {
    const tag = button.dataset.tag;
    const active = tag ? selectedRecipeTags.has(tag) : false;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function populateIngredientInputs(ingredients) {
  ingredientList.replaceChildren();
  const values = Array.isArray(ingredients) && ingredients.length > 0 ? ingredients : [""];
  values.forEach((value) => {
    ingredientList.append(createIngredientRow(value));
  });
}

function collectIngredients() {
  return Array.from(ingredientList.querySelectorAll("input[data-ingredient-input]"))
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function hasRequiredIngredientParts(value) {
  return /^\s*\d+(?:[.,]\d+)?\s+[A-Za-zÄÖÜäöüß]+\s+.+\s*$/.test(value);
}

function createIngredientRow(value = "") {
  const row = document.createElement("div");
  row.className = "ingredient-row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "z. B. 2 kg Kartoffeln";
  input.value = value;
  input.dataset.ingredientInput = "true";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "ghost-button ingredient-remove";
  removeButton.textContent = "Entfernen";
  removeButton.addEventListener("click", () => {
    row.remove();
    if (ingredientList.children.length === 0) {
      ingredientList.append(createIngredientRow());
    }
  });

  row.append(input, removeButton);
  return row;
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