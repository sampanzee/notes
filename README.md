# Notes

Schlichte Listen-App für die Familie – Ersatz für Microsoft To Do.

- Eigene Listen pro Person (Einkauf, Aufgaben, Geschenke, Urlaubsziele …), teilbar mit anderen
- Abhaken wird in Sekunden bei allen anderen sichtbar (Live-Verbindung)
- Funktioniert offline: Änderungen werden gespeichert und automatisch übertragen, sobald wieder Netz da ist
- Antippen öffnet Details: Fälligkeit, Notiz, in andere Liste verschieben
- „Geplant“ zeigt alle fälligen Punkte aus allen Listen
- Mehrere Zeilen einfügen = mehrere Punkte; ein erledigter Punkt mit gleichem Namen wird einfach wieder geöffnet
- Fotos an Punkten (Kamera oder Galerie), auch offline – werden später hochgeladen
- Sortierung pro Liste: wie hinzugefügt, neueste zuerst, alphabetisch, nach Fälligkeit
- Design: automatisch, hell oder dunkel; als App auf dem Handy installierbar
- Keine externen Pakete: Node.js 22 mit eingebauter SQLite-Datenbank

## Betrieb

Stack in Portainer mit `docker-compose.yml`. Daten liegen in `/volume1/docker/notes/data`.
Erreichbar über Nginx Proxy Manager (z. B. `notes.cloudgruber.de` → NAS-Port 3090).
Beim ersten Aufruf legt man das Verwalter-Konto an, weitere Personen unter Einstellungen → Familie.

## Update

```
cd /volume1/docker/notes
git pull
sudo docker build -t notes:latest .
```
Danach in Portainer den Container `notes` neu erstellen (Recreate). Daten und Fotos in `data/` bleiben erhalten.
