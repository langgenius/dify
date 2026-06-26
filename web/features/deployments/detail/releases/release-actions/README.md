# Deployment Releases Actions

Release action menu and dialogs for deploying, editing, deleting, and exporting releases.

## Internal Modules

| Module                                  | Why this module uses it                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `deploy-drawer/state`                   | Opens the deploy drawer from release actions.                           |
| `route-state`                           | Reads the route app instance identity for action queries and mutations. |
| `shared/components/detail-table-styles` | Reuses action trigger styles shared by detail tables.                   |
| `shared/components/title-tooltip`       | Shows full release action labels when text is truncated.                |
| `shared/domain/release-action`          | Reuses release/deployment action availability rules.                    |
| `shared/domain/runtime-status`          | Reuses deployment runtime status rules for action availability.         |

## External Modules

| Module           | Why this module uses it                 |
| ---------------- | --------------------------------------- |
| `utils/download` | Downloads exported release DSL content. |
