# Deployment Releases Actions

Release action menu and dialogs for deploying, editing, deleting, and exporting releases.

## External Modules

| Module                                           | Why this module uses it                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `@/utils/download`                               | Downloads exported release DSL content.                                  |
| `../../../deploy-drawer/state`                   | Opens the deploy drawer from release actions.                            |
| `../../../route-state`                           | Reads the route app instance identity for release mutations and exports. |
| `../../../shared/components/detail-table-styles` | Reuses action trigger styles shared by detail tables.                    |
| `../../../shared/components/title-tooltip`       | Shows full release action labels when text is truncated.                 |
| `../../../shared/domain/release-action`          | Reuses release/deployment action availability rules.                     |
| `../../../shared/domain/runtime-status`          | Reuses deployment runtime status rules for action availability.          |
| `../state`                                       | Reads releases route state for menu-scoped release deployment options.   |
