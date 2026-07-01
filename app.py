import json
import os
import re
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", BASE_DIR / "meal-planner.db"))
DAYS = [
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
]
MEALS = ["Fruehstueck", "Mittag", "Abendessen"]
WEEKLY_OPTION_GROUPS = {
    "snacks": [
        "Nuesse Mix",
        "Proteinriegel",
        "Obst to go",
        "Cracker",
        "Dunkle Schokolade",
    ],
    "household": [
        "Allzweckreiniger",
        "Spuelmittel",
        "Kuechenrolle",
        "Muellbeutel",
        "Waschmittel",
    ],
    "pantry": [
        "Reis",
        "Pasta",
        "Tomaten in Dosen",
        "Haferflocken",
        "Olivenoel",
    ],
}
SHOPPING_CATEGORY_ORDER = [
    "gemuese_obst",
    "kuehlung",
    "proteine",
    "backwaren",
    "trockenwaren",
    "gewuerze_oele",
    "snacks",
    "vorrat",
    "haushalt",
    "sonstiges",
]
SHOPPING_CATEGORY_KEYWORDS = {
    "gemuese_obst": [
        "tomate",
        "tomaten",
        "zwiebel",
        "knoblauch",
        "paprika",
        "zucchini",
        "karotte",
        "gurke",
        "salat",
        "kartoffel",
        "apfel",
        "banane",
        "obst",
        "gemuese",
        "gemuese",
    ],
    "kuehlung": [
        "milch",
        "joghurt",
        "quark",
        "kaese",
        "feta",
        "butter",
        "sahne",
        "mozzarella",
    ],
    "proteine": [
        "huhn",
        "haehn",
        "rind",
        "fisch",
        "lachs",
        "tofu",
        "ei",
        "eier",
        "bohnen",
        "linsen",
    ],
    "backwaren": ["brot", "broet", "toast", "wrap", "bröt", "bagel"],
    "trockenwaren": [
        "reis",
        "pasta",
        "nudel",
        "hafer",
        "mehl",
        "zucker",
        "dose",
        "konserve",
        "passata",
        "tomaten in dosen",
    ],
    "gewuerze_oele": ["oel", "öl", "essig", "salz", "pfeffer", "gewuerz", "gewürz"],
    "snacks": ["snack", "riegel", "cracker", "schokolade", "nuesse", "nüsse", "chips"],
    "haushalt": [
        "reiniger",
        "spuel",
        "spül",
        "kuechenrolle",
        "küchenrolle",
        "muell",
        "müll",
        "waschmittel",
        "putz",
    ],
    "vorrat": ["vorrat", "olivenoel", "olivenöl", "haferflocken", "pasta", "reis"],
}
INGREDIENT_PATTERN = re.compile(
    r"^\s*(?P<amount>\d+(?:[.,]\d+)?)\s*(?P<unit>[A-Za-z]+)?\s+(?P<name>.+?)\s*$"
)
INGREDIENT_REQUIRED_PATTERN = re.compile(
    r"^\s*(?P<amount>\d+(?:[.,]\d+)?)\s+(?P<unit>[A-Za-zÄÖÜäöüß]+)\s+(?P<name>.+?)\s*$"
)
DEFAULT_RECIPES = [
    {
        "id": str(uuid.uuid4()),
        "name": "One-Pot Pasta",
        "base_servings": 2,
        "tags": ["Mittag", "Abendessen"],
        "ingredients": ["500 g Pasta", "250 g Cherrytomaten", "1 Zwiebel", "2 Knoblauchzehen"],
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Ofengemuese mit Feta",
        "base_servings": 4,
        "tags": ["Mittag", "Abendessen"],
        "ingredients": ["3 Karotten", "2 Paprika", "1 Zucchini", "200 g Feta"],
    },
]

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")


def current_week_start():
    today = date.today()
    return today - timedelta(days=today.weekday())


def parse_week_start(raw_value):
    if raw_value is None:
        return current_week_start()

    text = str(raw_value).strip()
    if not text:
        return current_week_start()

    try:
        parsed = datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None

    return parsed - timedelta(days=parsed.weekday())


def week_start_key(week_start):
    return week_start.isoformat()


def ensure_week_slots(connection, week_start):
    week_key = week_start_key(week_start)
    existing_slots = {
        (row["day"], row["meal"])
        for row in connection.execute(
            "SELECT day, meal FROM meal_plan_entries WHERE week_start = ?",
            (week_key,),
        )
    }

    for day in DAYS:
        for meal in MEALS:
            if (day, meal) not in existing_slots:
                connection.execute(
                    "INSERT INTO meal_plan_entries (week_start, day, meal, recipe_id, servings) VALUES (?, ?, ?, NULL, NULL)",
                    (week_key, day, meal),
                )


def get_available_weeks(connection):
    rows = connection.execute(
        "SELECT DISTINCT week_start FROM meal_plan_entries ORDER BY week_start DESC"
    ).fetchall()
    return [row["week_start"] for row in rows]


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def normalize_key(value):
    return " ".join(str(value).strip().lower().split())


def infer_shopping_category(label, explicit_category=None):
    if explicit_category == "snacks":
        return "snacks"
    if explicit_category == "household":
        return "haushalt"
    if explicit_category == "pantry":
        return "vorrat"

    normalized = normalize_key(label)
    for category, keywords in SHOPPING_CATEGORY_KEYWORDS.items():
        if any(keyword in normalized for keyword in keywords):
            return category
    return "sonstiges"


def shopping_category_rank(category):
    try:
        return SHOPPING_CATEGORY_ORDER.index(category)
    except ValueError:
        return len(SHOPPING_CATEGORY_ORDER)


def recipe_servings_for(connection, recipe_id):
    row = connection.execute(
        "SELECT base_servings FROM recipes WHERE id = ?",
        (recipe_id,),
    ).fetchone()
    return row["base_servings"] if row else 2


def format_amount(value):
    rounded = round(value, 2)
    if abs(rounded - round(rounded)) < 0.01:
        return str(int(round(rounded)))
    text = f"{rounded:.2f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def parse_ingredient(ingredient):
    match = INGREDIENT_PATTERN.match(ingredient)
    if not match:
        return {
            "kind": "raw",
            "key": f"raw:{normalize_key(ingredient)}",
            "label": ingredient,
        }

    amount = float(match.group("amount").replace(",", "."))
    unit = (match.group("unit") or "").strip().lower()
    name = match.group("name").strip()
    return {
        "kind": "scaled",
        "key": f"scaled:{normalize_key(name)}|{unit}",
        "amount": amount,
        "unit": unit,
        "name": name,
    }


def build_shopping_list(connection, recipes, week_start):
    recipe_map = {recipe["id"]: recipe for recipe in recipes}
    checked_state = {
        row["item_key"]: bool(row["checked"])
        for row in connection.execute("SELECT item_key, checked FROM shopping_state")
    }
    aggregated = {}

    week_key = week_start_key(week_start)
    for row in connection.execute(
        "SELECT day, meal, recipe_id, servings FROM meal_plan_entries WHERE week_start = ? AND recipe_id IS NOT NULL",
        (week_key,),
    ):
        recipe = recipe_map.get(row["recipe_id"])
        if recipe is None:
            continue

        planned_servings = row["servings"] or recipe["baseServings"]
        scale_factor = planned_servings / max(recipe["baseServings"], 1)

        for ingredient in recipe["ingredients"]:
            parsed = parse_ingredient(ingredient)
            if parsed["kind"] == "scaled":
                entry = aggregated.setdefault(
                    parsed["key"],
                    {
                        "kind": "scaled",
                        "name": parsed["name"],
                        "unit": parsed["unit"],
                        "amount": 0,
                    },
                )
                entry["amount"] += parsed["amount"] * scale_factor
            else:
                entry = aggregated.setdefault(
                    parsed["key"],
                    {
                        "kind": "raw",
                        "label": parsed["label"],
                        "count": 0,
                    },
                )
                entry["count"] += scale_factor

    items = []
    for item_key, entry in aggregated.items():
        if entry["kind"] == "scaled":
            unit_part = f" {entry['unit']}" if entry["unit"] else ""
            label = f"{format_amount(entry['amount'])}{unit_part} {entry['name']}"
        else:
            if abs(entry["count"] - 1) < 0.01:
                label = entry["label"]
            else:
                label = f"{format_amount(entry['count'])} x {entry['label']}"

        items.append(
            {
                "id": item_key,
                "label": label,
                "checked": checked_state.get(item_key, False),
                "category": infer_shopping_category(label),
            }
        )

    for row in connection.execute(
        "SELECT category, item_key, label FROM weekly_options WHERE selected = 1 ORDER BY label ASC"
    ):
        weekly_item_id = f"weekly:{row['category']}:{row['item_key']}"
        items.append(
            {
                "id": weekly_item_id,
                "label": row["label"],
                "checked": checked_state.get(weekly_item_id, False),
                "category": infer_shopping_category(row["label"], row["category"]),
            }
        )

    items.sort(
        key=lambda item: (
            shopping_category_rank(item.get("category", "sonstiges")),
            normalize_key(item["label"]),
        )
    )
    return items


def serialize_state(week_start=None):
    resolved_week = week_start or current_week_start()
    week_key = week_start_key(resolved_week)

    with get_connection() as connection:
        ensure_week_slots(connection, resolved_week)

        recipes = [
            {
                "id": row["id"],
                "name": row["name"],
                "baseServings": row["base_servings"],
                "tags": json.loads(row["tags"]),
                "ingredients": json.loads(row["ingredients"]),
            }
            for row in connection.execute(
                "SELECT id, name, base_servings, tags, ingredients FROM recipes ORDER BY created_at DESC, name ASC"
            )
        ]
        week_plan = {
            day: {meal: {"recipeId": None, "servings": None} for meal in MEALS}
            for day in DAYS
        }
        for row in connection.execute(
            "SELECT day, meal, recipe_id, servings FROM meal_plan_entries WHERE week_start = ? ORDER BY day, meal",
            (week_key,),
        ):
            if row["day"] in week_plan and row["meal"] in week_plan[row["day"]]:
                week_plan[row["day"]][row["meal"]] = {
                    "recipeId": row["recipe_id"],
                    "servings": row["servings"],
                }

        shopping_list = build_shopping_list(connection, recipes, resolved_week)
        available_weeks = get_available_weeks(connection)
        weekly_options = {
            category: [
                {
                    "id": row["item_key"],
                    "label": row["label"],
                    "selected": bool(row["selected"]),
                }
                for row in connection.execute(
                    "SELECT item_key, label, selected FROM weekly_options WHERE category = ? ORDER BY label ASC",
                    (category,),
                )
            ]
            for category in WEEKLY_OPTION_GROUPS
        }

    return {
        "recipes": recipes,
        "weekPlan": week_plan,
        "shoppingList": shopping_list,
        "currentWeekStart": week_key,
        "availableWeeks": available_weeks,
        "weeklyOptions": weekly_options,
    }


def parse_recipe_payload(payload):
    name = str(payload.get("name", "")).strip()
    base_servings = payload.get("baseServings")
    tags = payload.get("tags", [])
    ingredients = payload.get("ingredients", [])

    if not name or not isinstance(ingredients, list) or not isinstance(tags, list):
        return None, "Ungueltige Rezeptdaten."

    try:
        base_servings = int(base_servings)
    except (TypeError, ValueError):
        return None, "Bitte eine gueltige Personenzahl angeben."

    if base_servings < 1:
        return None, "Die Personenzahl muss mindestens 1 sein."

    cleaned_ingredients = [str(item).strip() for item in ingredients if str(item).strip()]
    if not cleaned_ingredients:
        return None, "Mindestens eine Zutat ist erforderlich."

    invalid_ingredient = next(
        (item for item in cleaned_ingredients if INGREDIENT_REQUIRED_PATTERN.match(item) is None),
        None,
    )
    if invalid_ingredient is not None:
        return None, "Bitte jede Zutat mit Menge, Einheit und Name angeben (z. B. 2 kg Kartoffeln)."

    cleaned_tags = []
    for tag in tags:
        normalized_tag = str(tag).strip()
        if normalized_tag in MEALS and normalized_tag not in cleaned_tags:
            cleaned_tags.append(normalized_tag)

    if not cleaned_tags:
        return None, "Bitte mindestens ein Meal-Label waehlen."

    return {
        "name": name,
        "base_servings": base_servings,
        "tags": cleaned_tags,
        "ingredients": cleaned_ingredients,
    }, None


def ensure_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with get_connection() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                base_servings INTEGER NOT NULL DEFAULT 2,
                tags TEXT NOT NULL DEFAULT '[]',
                ingredients TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        recipe_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(recipes)")
        }
        if "base_servings" not in recipe_columns:
            connection.execute(
                "ALTER TABLE recipes ADD COLUMN base_servings INTEGER NOT NULL DEFAULT 2"
            )
        if "tags" not in recipe_columns:
            connection.execute(
                "ALTER TABLE recipes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'"
            )
            connection.execute(
                "UPDATE recipes SET tags = ? WHERE tags IS NULL OR tags = '[]' OR tags = ''",
                (json.dumps(MEALS),),
            )

        legacy_week_plan_rows = []
        week_plan_exists = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'week_plan'"
        ).fetchone()
        if week_plan_exists:
            week_plan_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(week_plan)")
            }
            if "meal" not in week_plan_columns and "recipe_id" in week_plan_columns:
                legacy_week_plan_rows = connection.execute(
                    "SELECT day, recipe_id FROM week_plan"
                ).fetchall()

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS meal_plan (
                day TEXT NOT NULL,
                meal TEXT NOT NULL,
                recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
                servings INTEGER,
                PRIMARY KEY (day, meal)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS meal_plan_entries (
                week_start TEXT NOT NULL,
                day TEXT NOT NULL,
                meal TEXT NOT NULL,
                recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
                servings INTEGER,
                PRIMARY KEY (week_start, day, meal)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS shopping_state (
                item_key TEXT PRIMARY KEY,
                checked INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS weekly_options (
                category TEXT NOT NULL,
                item_key TEXT NOT NULL,
                label TEXT NOT NULL,
                selected INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (category, item_key)
            )
            """
        )

        current_week = current_week_start()
        migrated_count = connection.execute(
            "SELECT COUNT(*) AS count FROM meal_plan_entries"
        ).fetchone()["count"]
        if migrated_count == 0:
            for row in connection.execute("SELECT day, meal, recipe_id, servings FROM meal_plan"):
                connection.execute(
                    """
                    INSERT OR REPLACE INTO meal_plan_entries (week_start, day, meal, recipe_id, servings)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        week_start_key(current_week),
                        row["day"],
                        row["meal"],
                        row["recipe_id"],
                        row["servings"],
                    ),
                )

        ensure_week_slots(connection, current_week)

        recipe_count = connection.execute("SELECT COUNT(*) AS count FROM recipes").fetchone()["count"]
        if recipe_count == 0:
            connection.executemany(
                "INSERT INTO recipes (id, name, base_servings, tags, ingredients) VALUES (?, ?, ?, ?, ?)",
                [
                    (
                        recipe["id"],
                        recipe["name"],
                        recipe["base_servings"],
                        json.dumps(recipe["tags"]),
                        json.dumps(recipe["ingredients"]),
                    )
                    for recipe in DEFAULT_RECIPES
                ],
            )

        assigned_slots = connection.execute(
            "SELECT COUNT(*) AS count FROM meal_plan_entries WHERE week_start = ? AND recipe_id IS NOT NULL",
            (week_start_key(current_week),),
        ).fetchone()["count"]
        if assigned_slots == 0 and legacy_week_plan_rows:
            for row in legacy_week_plan_rows:
                if not row["recipe_id"]:
                    continue
                connection.execute(
                    "UPDATE meal_plan_entries SET recipe_id = ?, servings = ? WHERE week_start = ? AND day = ? AND meal = ?",
                    (
                        row["recipe_id"],
                        recipe_servings_for(connection, row["recipe_id"]),
                        week_start_key(current_week),
                        row["day"],
                        "Abendessen",
                    ),
                )

        for category, labels in WEEKLY_OPTION_GROUPS.items():
            for label in labels:
                item_key = normalize_key(label)
                connection.execute(
                    """
                    INSERT INTO weekly_options (category, item_key, label, selected)
                    VALUES (?, ?, ?, 0)
                    ON CONFLICT(category, item_key) DO NOTHING
                    """,
                    (category, item_key, label),
                )


@app.get("/api/health")
def health_check():
    return jsonify({"ok": True})


@app.get("/api/state")
def get_state():
    week_start = parse_week_start(request.args.get("weekStart"))
    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400
    return jsonify(serialize_state(week_start))


@app.post("/api/recipes")
def create_recipe():
    payload = request.get_json(silent=True) or {}
    recipe_data, error = parse_recipe_payload(payload)
    if error:
        return jsonify({"error": error}), 400

    with get_connection() as connection:
        connection.execute(
            "INSERT INTO recipes (id, name, base_servings, tags, ingredients) VALUES (?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                recipe_data["name"],
                recipe_data["base_servings"],
                json.dumps(recipe_data["tags"]),
                json.dumps(recipe_data["ingredients"]),
            ),
        )

    week_start = parse_week_start(request.args.get("weekStart"))
    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400
    return jsonify(serialize_state(week_start))


@app.put("/api/recipes/<recipe_id>")
def update_recipe(recipe_id):
    payload = request.get_json(silent=True) or {}
    recipe_data, error = parse_recipe_payload(payload)
    if error:
        return jsonify({"error": error}), 400

    with get_connection() as connection:
        existing_recipe = connection.execute(
            "SELECT id FROM recipes WHERE id = ?",
            (recipe_id,),
        ).fetchone()
        if existing_recipe is None:
            return jsonify({"error": "Rezept nicht gefunden."}), 404

        connection.execute(
            "UPDATE recipes SET name = ?, base_servings = ?, tags = ?, ingredients = ? WHERE id = ?",
            (
                recipe_data["name"],
                recipe_data["base_servings"],
                json.dumps(recipe_data["tags"]),
                json.dumps(recipe_data["ingredients"]),
                recipe_id,
            ),
        )

    week_start = parse_week_start(request.args.get("weekStart"))
    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400
    return jsonify(serialize_state(week_start))


@app.delete("/api/recipes/<recipe_id>")
def delete_recipe(recipe_id):
    with get_connection() as connection:
        connection.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))

    week_start = parse_week_start(request.args.get("weekStart"))
    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400
    return jsonify(serialize_state(week_start))


@app.put("/api/week-plan")
def update_week_plan():
    payload = request.get_json(silent=True) or {}
    day = payload.get("day")
    meal = payload.get("meal")
    recipe_id = payload.get("recipeId")
    servings = payload.get("servings")
    week_start = parse_week_start(payload.get("weekStart"))

    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400

    if day not in DAYS or meal not in MEALS:
        return jsonify({"error": "Unbekannter Plan-Slot."}), 400

    with get_connection() as connection:
        ensure_week_slots(connection, week_start)
        week_key = week_start_key(week_start)

        if recipe_id is None:
            connection.execute(
                "UPDATE meal_plan_entries SET recipe_id = NULL, servings = NULL WHERE week_start = ? AND day = ? AND meal = ?",
                (week_key, day, meal),
            )
            return jsonify(serialize_state(week_start))

        recipe = connection.execute(
            "SELECT id, base_servings FROM recipes WHERE id = ?",
            (recipe_id,),
        ).fetchone()
        if recipe is None:
            return jsonify({"error": "Rezept nicht gefunden."}), 404

        try:
            servings = int(servings) if servings is not None else recipe["base_servings"]
        except (TypeError, ValueError):
            return jsonify({"error": "Ungueltige Personenzahl fuer den Plan."}), 400

        if servings < 1:
            return jsonify({"error": "Die Personenzahl im Plan muss mindestens 1 sein."}), 400

        connection.execute(
            "UPDATE meal_plan_entries SET recipe_id = ?, servings = ? WHERE week_start = ? AND day = ? AND meal = ?",
            (recipe_id, servings, week_key, day, meal),
        )

    return jsonify(serialize_state(week_start))


@app.post("/api/week-plan/reset")
def reset_week_plan():
    payload = request.get_json(silent=True) or {}
    week_start = parse_week_start(payload.get("weekStart"))
    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400

    with get_connection() as connection:
        ensure_week_slots(connection, week_start)
        connection.execute(
            "UPDATE meal_plan_entries SET recipe_id = NULL, servings = NULL WHERE week_start = ?",
            (week_start_key(week_start),),
        )

    return jsonify(serialize_state(week_start))


@app.put("/api/shopping-list")
def update_shopping_item():
    payload = request.get_json(silent=True) or {}
    item_id = str(payload.get("itemId", "")).strip()
    checked = bool(payload.get("checked", False))

    if not item_id:
        return jsonify({"error": "Ungueltiger Einkaufslisten-Eintrag."}), 400

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO shopping_state (item_key, checked) VALUES (?, ?)
            ON CONFLICT(item_key) DO UPDATE SET checked = excluded.checked
            """,
            (item_id, int(checked)),
        )

    week_start = parse_week_start(request.args.get("weekStart"))
    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400
    return jsonify(serialize_state(week_start))


@app.put("/api/weekly-options")
def update_weekly_option():
    payload = request.get_json(silent=True) or {}
    category = str(payload.get("category", "")).strip()
    item_id = str(payload.get("itemId", "")).strip()
    selected = bool(payload.get("selected", False))

    if category not in WEEKLY_OPTION_GROUPS or not item_id:
        return jsonify({"error": "Ungueltige Wochenauswahl."}), 400

    with get_connection() as connection:
        row = connection.execute(
            "SELECT item_key FROM weekly_options WHERE category = ? AND item_key = ?",
            (category, item_id),
        ).fetchone()
        if row is None:
            return jsonify({"error": "Auswahl nicht gefunden."}), 404

        connection.execute(
            "UPDATE weekly_options SET selected = ? WHERE category = ? AND item_key = ?",
            (int(selected), category, item_id),
        )

    week_start = parse_week_start(request.args.get("weekStart"))
    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400
    return jsonify(serialize_state(week_start))


@app.post("/api/weekly-options")
def create_weekly_option():
    payload = request.get_json(silent=True) or {}
    category = str(payload.get("category", "")).strip()
    label = str(payload.get("label", "")).strip()

    if category not in WEEKLY_OPTION_GROUPS or not label:
        return jsonify({"error": "Ungueltige Wochenauswahl."}), 400

    item_key = normalize_key(label)
    if not item_key:
        return jsonify({"error": "Ungueltige Wochenauswahl."}), 400

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO weekly_options (category, item_key, label, selected)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(category, item_key)
            DO UPDATE SET label = excluded.label, selected = 1
            """,
            (category, item_key, label),
        )

    week_start = parse_week_start(request.args.get("weekStart"))
    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400
    return jsonify(serialize_state(week_start))


@app.delete("/api/weekly-options")
def delete_weekly_option():
    payload = request.get_json(silent=True) or {}
    category = str(payload.get("category", "")).strip()
    item_id = str(payload.get("itemId", "")).strip()

    if category not in WEEKLY_OPTION_GROUPS or not item_id:
        return jsonify({"error": "Ungueltige Wochenauswahl."}), 400

    with get_connection() as connection:
        row = connection.execute(
            "SELECT item_key FROM weekly_options WHERE category = ? AND item_key = ?",
            (category, item_id),
        ).fetchone()
        if row is None:
            return jsonify({"error": "Auswahl nicht gefunden."}), 404

        connection.execute(
            "DELETE FROM weekly_options WHERE category = ? AND item_key = ?",
            (category, item_id),
        )
        connection.execute(
            "DELETE FROM shopping_state WHERE item_key = ?",
            (f"weekly:{category}:{item_id}",),
        )

    week_start = parse_week_start(request.args.get("weekStart"))
    if week_start is None:
        return jsonify({"error": "Ungültige Woche."}), 400
    return jsonify(serialize_state(week_start))


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(BASE_DIR, path)


ensure_database()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    from wsgiref.simple_server import make_server

    print(f"Running WSGI server on http://0.0.0.0:{port}")
    with make_server("0.0.0.0", port, app) as server:
        server.serve_forever()