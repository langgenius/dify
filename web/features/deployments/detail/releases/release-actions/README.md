# Deployment Releases Actions

Release action menu and dialogs for deploying, editing, deleting, and exporting releases.

## Internal Modules

| Module          | Why this module uses it                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `deploy-drawer` | Opens the deploy drawer from release actions.                                  |
| `shared`        | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`   | Reads the route app instance identity for action queries and mutations.        |

## External Modules

| Module           | Why this module uses it                 |
| ---------------- | --------------------------------------- |
| `utils/download` | Downloads exported release DSL content. |
