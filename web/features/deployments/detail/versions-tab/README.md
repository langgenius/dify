# Deployment Versions Tab

Versions tab for release history, release actions, deployment summaries, and release DSL export.

## External Modules

| Module                                        | Why this module uses it                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `@/app/components/base/skeleton`              | Reuses skeleton primitives for release history table loading states.                           |
| `@/hooks/use-format-time-from-now`            | Formats relative release timestamps in release history rows.                                   |
| `@/utils/download`                            | Downloads exported release DSL content.                                                        |
| `../../deploy-drawer/state`                   | Opens the deploy drawer from release actions.                                                  |
| `../../route-state`                           | Reads the route app instance identity for release queries and mutations.                       |
| `../../shared/components/empty-state`         | Reuses deployment empty/error state presentation for release history.                          |
| `../../shared/components/title-tooltip`       | Shows full release labels and action labels when text is truncated.                            |
| `../../shared/domain/pagination`              | Reuses release history page size for query and pagination display.                             |
| `../../shared/domain/release-action`          | Reuses release/deployment action availability rules for release action menus.                  |
| `../../shared/domain/runtime-status`          | Reuses deployment runtime status rules for release action availability and deployed-to badges. |
| `../../shared/components/detail-table`        | Reuses the detail table layout for desktop and mobile release rows.                            |
| `../../shared/components/detail-table-styles` | Reuses column class names and action trigger styles shared by detail tables.                   |
