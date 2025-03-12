# MITWIRKEN

So, du möchtest zu Dify beitragen – das ist großartig, wir können es kaum erwarten, zu sehen, was du beisteuern wirst. Als ein Startup mit begrenzter Mitarbeiterzahl und Finanzierung haben wir große Ambitionen, den intuitivsten Workflow zum Aufbau und zur Verwaltung von LLM-Anwendungen zu entwickeln. Jede Unterstützung aus der Community zählt wirklich.

Dieser Leitfaden, ebenso wie Dify selbst, ist ein ständig in Entwicklung befindliches Projekt. Wir schätzen Ihr Verständnis, falls er zeitweise hinter dem tatsächlichen Projekt zurückbleibt, und freuen uns über jegliches Feedback, das uns hilft, ihn zu verbessern.

Bezüglich der Lizenzierung nehmen Sie sich bitte einen Moment Zeit, um unser kurzes [License and Contributor Agreement](./LICENSE) zu lesen. Die Community hält sich außerdem an den [Code of Conduct](https://github.com/langgenius/.github/blob/main/CODE_OF_CONDUCT.md).

## Bevor Sie loslegen

[Finde](https://github.com/langgenius/dify/issues?q=is:issue+is:open) ein bestehendes Issue, oder [öffne](https://github.com/langgenius/dify/issues/new/choose) ein neues. Wir kategorisieren Issues in zwei Typen:

### Feature-Anfragen

* Wenn Sie eine neue Feature-Anfrage stellen, bitten wir Sie zu erklären, was das vorgeschlagene Feature bewirken soll und so viel Kontext wie möglich bereitzustellen. [@perzeusss](https://github.com/perzeuss) hat einen soliden [Feature Request Copilot](https://udify.app/chat/MK2kVSnw1gakVwMX) entwickelt, der Ihnen dabei hilft, Ihre Anforderungen zu formulieren. Probieren Sie ihn gerne aus.

* Wenn Sie eines der bestehenden Issues übernehmen möchten, hinterlassen Sie einfach einen Kommentar darunter, in dem Sie uns dies mitteilen.

  Ein Teammitglied, das in der entsprechenden Richtung arbeitet, wird hinzugezogen. Wenn alles in Ordnung ist, gibt es das Okay, mit der Codierung zu beginnen. Wir bitten Sie, mit der Umsetzung des Features zu warten, damit keine Ihrer Arbeiten verloren gehen sollte unsererseits Änderungen vorgeschlagen werden.

  Je nachdem, in welchen Bereich das vorgeschlagene Feature fällt, können Sie mit verschiedenen Teammitgliedern sprechen. Hier ist eine Übersicht der Bereiche, an denen unsere Teammitglieder derzeit arbeiten:

  | Member                                                       | Scope                                                |
  | ------------------------------------------------------------ | ---------------------------------------------------- |
  | [@yeuoly](https://github.com/Yeuoly)                         | Architecting Agents                                  |
  | [@jyong](https://github.com/JohnJyong)                       | RAG pipeline design                                  |
  | [@GarfieldDai](https://github.com/GarfieldDai)               | Building workflow orchestrations                     |
  | [@iamjoel](https://github.com/iamjoel) & [@zxhlyh](https://github.com/zxhlyh) | Making our frontend a breeze to use                  |
  | [@guchenhe](https://github.com/guchenhe) & [@crazywoola](https://github.com/crazywoola) | Developer experience, points of contact for anything |
  | [@takatost](https://github.com/takatost)                     | Overall product direction and architecture           |

  Wie wir Prioritäten setzen:

  | Feature Type                                                 | Priority        |
  | ------------------------------------------------------------ | --------------- |
  | Funktionen mit hoher Priorität, wie sie von einem Teammitglied gekennzeichnet wurden     | High Priority   |
  | Beliebte Funktionsanfragen von unserem [Community-Feedback-Board](https://github.com/langgenius/dify/discussions/categories/feedbacks) | Medium Priority |
  | Nicht-Kernfunktionen und kleinere Verbesserungen                    | Low Priority    |
  | Wertvoll, aber nicht unmittelbar                                  | Future-Feature  |

### Sonstiges (e.g. bug report, performance optimization, typo correction)

* Fangen Sie sofort an zu programmieren..

  Wie wir Prioritäten setzen:

  | Issue Type                                                   | Priority        |
  | ------------------------------------------------------------ | --------------- |
  | Fehler in Kernfunktionen (Anmeldung nicht möglich, Anwendungen funktionieren nicht, Sicherheitslücken) | Critical        |
  | Nicht-kritische Fehler, Leistungsverbesserungen                     | Medium Priority |
  | Kleinere Fehlerkorrekturen (Schreibfehler, verwirrende, aber funktionierende Benutzeroberfläche)                | Low Priority    |

## Installieren

Hier sind die Schritte, um Dify für die Entwicklung einzurichten:

### 1. Fork dieses Repository

### 2. Clone das Repo

 Klonen Sie das geforkte Repository von Ihrem Terminal aus:

```shell
git clone git@github.com:<github_username>/dify.git
```

### 3. Abhängigkeiten prüfen

Dify benötigt die folgenden Abhängigkeiten zum Bauen – stellen Sie sicher, dass sie auf Ihrem System installiert sind:

* [Docker](https://www.docker.com/)
* [Docker Compose](https://docs.docker.com/compose/install/)
* [Node.js v18.x (LTS)](http://nodejs.org)
* [pnpm](https://pnpm.io/)
* [Python](https://www.python.org/) version 3.11.x or 3.12.x

### 4. Installationen

Dify setzt sich aus einem Backend und einem Frontend zusammen. Wechseln Sie in das Backend-Verzeichnis mit `cd api/` und folgen Sie der [Backend README](api/README.md) zur Installation. Öffnen Sie in einem separaten Terminal das Frontend-Verzeichnis mit `cd web/` und folgen Sie der [Frontend README](web/README.md) zur Installation.

Überprüfen Sie die [Installation FAQ](https://docs.dify.ai/learn-more/faq/install-faq) für eine Liste bekannter Probleme und Schritte zur Fehlerbehebung.

### 5. Besuchen Sie dify in Ihrem Browser

Um Ihre Einrichtung zu validieren, öffnen Sie Ihren Browser und navigieren Sie zu [http://localhost:3000](http://localhost:3000) (Standardwert oder Ihre selbst konfigurierte URL und Port). Sie sollten nun Dify im laufenden Betrieb sehen.

## Entwickeln

Wenn Sie einen Modellanbieter hinzufügen, ist [dieser Leitfaden](https://github.com/langgenius/dify/blob/main/api/core/model_runtime/README.md) für Sie.

Wenn Sie einen Tool-Anbieter für Agent oder Workflow hinzufügen möchten, ist [dieser Leitfaden](./api/core/tools/README.md) für Sie.

Um Ihnen eine schnelle Orientierung zu bieten, wo Ihr Beitrag passt, folgt eine kurze, kommentierte Übersicht des Backends und Frontends von Dify:

### Backend

Dify’s Backend ist in Python geschrieben und nutzt [Flask](https://flask.palletsprojects.com/en/3.0.x/) als Web-Framework. Es verwendet [SQLAlchemy](https://www.sqlalchemy.org/) für ORM und [Celery](https://docs.celeryq.dev/en/stable/getting-started/introduction.html) für Task-Queueing. Die Autorisierungslogik erfolgt über Flask-login.

```text
[api/]
├── constants             // Konstante Einstellungen, die in der gesamten Codebasis verwendet werden.
├── controllers           // API-Routendefinitionen und Logik zur Bearbeitung von Anfragen.
├── core                  // Orchestrierung von Kernanwendungen, Modellintegrationen und Tools.
├── docker                // Konfigurationen im Zusammenhang mit Docker und Containerisierung.
├── events                // Ereignisbehandlung und -verarbeitung
├── extensions            // Erweiterungen mit Frameworks/Plattformen von Drittanbietern.
├── fields                // Felddefinitionen für die Serialisierung/Marshalling.
├── libs                  // Wiederverwendbare Bibliotheken und Hilfsprogramme
├── migrations            // Skripte für die Datenbankmigration.
├── models                // Datenbankmodelle und Schemadefinitionen.
├── services              // Gibt die Geschäftslogik an.
├── storage               // Speicherung privater Schlüssel.   
├── tasks                 // Handhabung von asynchronen Aufgaben und Hintergrundaufträgen.
└── tests
```

### Frontend

Die Website basiert auf einem [Next.js](https://nextjs.org/)-Boilerplate in TypeScript und verwendet [Tailwind CSS](https://tailwindcss.com/) für das Styling. [React-i18next](https://react.i18next.com/) wird für die Internationalisierung genutzt.

```text
[web/]
├── app                   // Layouts, Seiten und Komponenten
│   ├── (commonLayout)    // gemeinsames Layout für die gesamte Anwendung
│   ├── (shareLayout)     // Layouts, die speziell für tokenspezifische Sitzungen gemeinsam genutzt werden 
│   ├── activate          // Seite aufrufen
│   ├── components        // gemeinsam genutzt von Seiten und Layouts
│   ├── install           // Seite installieren
│   ├── signin            // Anmeldeseite
│   └── styles            // global geteilte Stile
├── assets                // Statische Vermögenswerte
├── bin                   // Skripte, die beim Build-Schritt ausgeführt werden
├── config                // einstellbare Einstellungen und Optionen 
├── context               // gemeinsame Kontexte, die von verschiedenen Teilen der Anwendung verwendet werden
├── dictionaries          // Sprachspezifische Übersetzungsdateien 
├── docker                // Container-Konfigurationen
├── hooks                 // Wiederverwendbare Haken
├── i18n                  // Konfiguration der Internationalisierung
├── models                // beschreibt Datenmodelle und Formen von API-Antworten
├── public                // Meta-Assets wie Favicon
├── service               // legt Formen von API-Aktionen fest
├── test                  
├── types                 // Beschreibungen von Funktionsparametern und Rückgabewerten
└── utils                 // Gemeinsame Nutzenfunktionen
```

## Einreichung Ihrer PR

Am Ende ist es Zeit, einen Pull Request (PR) in unserem Repository zu eröffnen. Für wesentliche Features mergen wir diese zunächst in den `deploy/dev`-Branch zum Testen, bevor sie in den `main`-Branch übernommen werden. Falls Sie auf Probleme wie Merge-Konflikte stoßen oder nicht wissen, wie man einen Pull Request erstellt, schauen Sie sich [GitHub's Pull Request Tutorial](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests) an.

Und das war's! Sobald Ihr PR gemerged wurde, werden Sie als Mitwirkender in unserem [README](https://github.com/langgenius/dify/blob/main/README.md) aufgeführt.

## Hilfe bekommen

Wenn Sie beim Beitragen jemals nicht weiter wissen oder eine brennende Frage haben, richten Sie Ihre Anfrage einfach über das entsprechende GitHub-Issue an uns oder besuchen Sie unseren [Discord](https://discord.gg/8Tpq4AcN9c) für ein kurzes Gespräch.
