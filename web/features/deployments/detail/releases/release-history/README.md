# Deployment Releases History

Release history section for rendering release rows, deployment summaries, and pagination on the releases route.

## External Modules

| Module                                           | Why this module uses it                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `@/app/components/base/skeleton`                 | Reuses skeleton primitives for release history loading states.     |
| `@/hooks/use-format-time-from-now`               | Formats relative release timestamps in release history rows.       |
| `../../../shared/components/detail-table`        | Reuses the detail table layout for desktop and mobile rows.        |
| `../../../shared/components/detail-table-styles` | Reuses column class names shared by detail tables.                 |
| `../../../shared/components/empty-state`         | Reuses deployment empty/error state presentation for history rows. |
| `../../../shared/components/title-tooltip`       | Shows full release labels when text is truncated.                  |
| `../../../shared/domain/pagination`              | Reuses release history page size for pagination display.           |
| `../../../shared/domain/release`                 | Formats release metadata shown in history rows.                    |
| `../../../shared/domain/runtime-status`          | Reuses runtime status rules for deployed-to badges.                |
| `../../../shared/ui/deployment-status-style`     | Reuses deployment status label mapping for deployed-to badges.     |
| `../release-actions/deploy-release-menu`         | Renders release action menus inside release history rows.          |
| `../state`                                       | Reads releases route query and pagination state.                   |
