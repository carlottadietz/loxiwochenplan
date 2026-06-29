import json
import os
import sqlite3
import uuid
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
DEFAULT_RECIPES = [
    {
        "id": str(uuid.uuid4()),
        "name": "One-Pot Pasta",
        "ingredients": ["500 g Pasta", "250 g Cherrytomaten", "1 Zwiebel", "2 Knoblauchzehen"],
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Ofengemuese mit Feta",
        "ingredients": ["3 Karotten", "2 Paprika", "1 Zucchini", "200 g Feta"],
    },
]

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def ensure_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with get_connection() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                ingredients TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS week_plan (
                day TEXT PRIMARY KEY,
                recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL
            )
            """
        )

        existing_days = {
            row["day"] for row in connection.execute("SELECT day FROM week_plan")
        }
        for day in DAYS:
            if day not in existing_days:
                connection.execute("INSERT INTO week_plan (day, recipe_id) VALUES (?, NULL)", (day,))

        recipe_count = connection.execute("SELECT COUNT(*) AS count FROM recipes").fetchone()["count"]
        if recipe_count == 0:
            connection.executemany(
                "INSERT INTO recipes (id, name, ingredients) VALUES (?, ?, ?)",
                [
                    (recipe["id"], recipe["name"], json.dumps(recipe["ingredients"]))
                    for recipe in DEFAULT_RECIPES
                ],
            )


def serialize_state():
    with get_connection() as connection:
        recipes = [
            {
                "id": row["id"],
                "name": row["name"],
                "ingredients": json.loads(row["ingredients"]),
            }
            for row in connection.execute(
                "SELECT id, name, ingredients FROM recipes ORDER BY created_at DESC, name ASC"
            )
        ]
        week_plan = {
            row["day"]: row["recipe_id"]
            for row in connection.execute("SELECT day, recipe_id FROM week_plan")
        }

    return {"recipes": recipes, "weekPlan": week_plan}


@app.get("/api/health")
def health_check():
    return jsonify({"ok": True})


@app.get("/api/state")
def get_state():
    return jsonify(serialize_state())


@app.post("/api/recipes")
def create_recipe():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    ingredients = payload.get("ingredients", [])

    if not name or not isinstance(ingredients, list):
        return jsonify({"error": "Ungueltige Rezeptdaten."}), 400

    cleaned_ingredients = [str(item).strip() for item in ingredients if str(item).strip()]
    if not cleaned_ingredients:
        return jsonify({"error": "Mindestens eine Zutat ist erforderlich."}), 400

    with get_connection() as connection:
        connection.execute(
            "INSERT INTO recipes (id, name, ingredients) VALUES (?, ?, ?)",
            (str(uuid.uuid4()), name, json.dumps(cleaned_ingredients)),
        )

    return jsonify(serialize_state())


@app.delete("/api/recipes/<recipe_id>")
def delete_recipe(recipe_id):
    with get_connection() as connection:
        connection.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))

    return jsonify(serialize_state())


@app.put("/api/week-plan")
def update_week_plan():
    payload = request.get_json(silent=True) or {}
    day = payload.get("day")
    recipe_id = payload.get("recipeId")

    if day not in DAYS:
        return jsonify({"error": "Unbekannter Wochentag."}), 400

    with get_connection() as connection:
        if recipe_id is not None:
            recipe_exists = connection.execute(
                "SELECT 1 FROM recipes WHERE id = ?",
                (recipe_id,),
            ).fetchone()
            if recipe_exists is None:
                return jsonify({"error": "Rezept nicht gefunden."}), 404

        connection.execute(
            "UPDATE week_plan SET recipe_id = ? WHERE day = ?",
            (recipe_id, day),
        )

    return jsonify(serialize_state())


@app.post("/api/week-plan/reset")
def reset_week_plan():
    with get_connection() as connection:
        connection.execute("UPDATE week_plan SET recipe_id = NULL")

    return jsonify(serialize_state())


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(BASE_DIR, path)


ensure_database()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "10000")))