# Loxi Wochenplan

Eine kleine Web-App fuer gemeinsame Essensplanung mit Rezepten, Drag-and-Drop-Wochenplan und automatischer Einkaufsliste.

## Was jetzt anders ist

- Rezepte und Wochenplan liegen nicht mehr nur im Browser
- Daten werden serverseitig in SQLite gespeichert
- Zwei Personen sehen denselben Plan
- Das Frontend synchronisiert den Stand regelmaessig neu
- Rezepte haben eine Basis-Personenzahl
- Rezepte haben mehrere Meal-Labels fuer Fruehstueck, Mittag und Abendessen
- Jeder Tag ist in Fruehstueck, Mittag und Abendessen aufgeteilt
- Die Personenzahl pro eingeplantem Rezept kann im Wochenplan angepasst werden
- Die Einkaufsliste ist direkt auf der Website abhakbar

## Lokal starten

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
gunicorn --bind 127.0.0.1:10000 app:app
```

Danach im Browser `http://localhost:10000` oeffnen.

## Render Setup

Fuer gemeinsame Nutzung brauchst du in Render jetzt einen `Web Service`, keine `Static Site`.

- Runtime: `Python`
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn --bind 0.0.0.0:$PORT app:app`
- Health Check Path: `/api/health`
- Plan: mindestens ein bezahlter Plan, wenn du die Daten ueber Restarts und Deploys behalten willst

## Warum die Warning kam

`python app.py` startet den eingebauten Flask-Entwicklungsserver. Der ist fuer lokales Entwickeln gedacht, aber nicht fuer produktive Deployments. In Produktion sollte ein WSGI-Server wie `gunicorn` davor laufen. Genau das ist jetzt in [render.yaml](render.yaml) hinterlegt.

## Wichtiger Punkt fuer dauerhafte Daten

Damit die SQLite-Datei auf Render nicht verloren geht, braucht der Service eine `Persistent Disk`.

- Mount Path: `/var/data`
- Datenbankpfad: `/var/data/meal-planner.db`

Die passende Konfiguration ist bereits in [render.yaml](render.yaml) hinterlegt.

## Hinweise

- Die Zusammenarbeit ist gemeinsam, aber nicht in Echtzeit per WebSocket.
- Der Client synchronisiert automatisch in Intervallen und per Klick auf `Jetzt synchronisieren`.
- Bei gleichzeitigen Aenderungen gilt praktisch `last write wins`.
- Mengen in der Einkaufsliste werden anhand der Personenzahl im Wochenplan hoch- oder runtergerechnet, wenn der Anfang der Zutat numerisch ist.

## Funktionen

- Rezepte mit Zutaten anlegen
- Basis-Personenzahl pro Rezept speichern
- Mehrere Meal-Labels pro Rezept speichern
- Rezepte fuer alle speichern und loeschen
- Rezepte pro Mahlzeit aus einer Auswahl auswaehlen
- Personenzahl pro eingeplantem Rezept direkt im Wochenplan aendern
- Einkaufsliste aus allen eingeplanten Rezepten erzeugen
- Einkaufsliste direkt im Browser abhaken