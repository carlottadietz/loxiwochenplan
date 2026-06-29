# Loxi Wochenplan

Eine kleine Web-App fuer gemeinsame Essensplanung mit Rezepten, Drag-and-Drop-Wochenplan und automatischer Einkaufsliste.

## Was jetzt anders ist

- Rezepte und Wochenplan liegen nicht mehr nur im Browser
- Daten werden serverseitig in SQLite gespeichert
- Zwei Personen sehen denselben Plan
- Das Frontend synchronisiert den Stand regelmaessig neu

## Lokal starten

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Danach im Browser `http://localhost:10000` oeffnen.

## Render Setup

Fuer gemeinsame Nutzung brauchst du in Render jetzt einen `Web Service`, keine `Static Site`.

- Runtime: `Python`
- Build Command: `pip install -r requirements.txt`
- Start Command: `python app.py`
- Health Check Path: `/api/health`
- Plan: mindestens ein bezahlter Plan, wenn du die Daten ueber Restarts und Deploys behalten willst

## Wichtiger Punkt fuer dauerhafte Daten

Damit die SQLite-Datei auf Render nicht verloren geht, braucht der Service eine `Persistent Disk`.

- Mount Path: `/var/data`
- Datenbankpfad: `/var/data/meal-planner.db`

Die passende Konfiguration ist bereits in [render.yaml](render.yaml) hinterlegt.

## Hinweise

- Die Zusammenarbeit ist gemeinsam, aber nicht in Echtzeit per WebSocket.
- Der Client synchronisiert automatisch in Intervallen und per Klick auf `Jetzt synchronisieren`.
- Bei gleichzeitigen Aenderungen gilt praktisch `last write wins`.

## Funktionen

- Rezepte mit Zutaten anlegen
- Rezepte fuer alle speichern und loeschen
- Rezepte per Drag-and-Drop auf Wochentage ziehen
- Einkaufsliste aus allen eingeplanten Rezepten erzeugen