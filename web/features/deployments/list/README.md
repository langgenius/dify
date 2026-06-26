# Deployments List

Deployment list page for browsing app instances, filtering by keyword or environment, and rendering deployment status cards.

## External Modules

| Module                                     | Why this module uses it                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@/app/components/apps/studio-list-header` | Reuses the app studio list header layout instead of defining a list-specific page chrome.                                                                          |
| `@/app/components/base/skeleton`           | Reuses the existing skeleton primitive for list and card loading states.                                                                                           |
| `../../shared/domain/*`                    | Reuses deployment domain rules for pagination, runtime status, and release date formatting. These helpers are pure domain logic shared across deployment surfaces. |
| `../../shared/hooks/use-infinite-scroll`   | Centralizes infinite-scroll observation and next-page triggering for query results.                                                                                |
| `../../shared/ui/*`                        | Reuses deployment status badges and status label styling so list cards match detail surfaces.                                                                      |
| `../../components/empty-state`             | Reuses deployment empty/error state presentation.                                                                                                                  |
| `../../components/deployment-actions`      | Reuses the deployment action menu for each card. The list supplies the app instance identity and placement only.                                                   |
| `../../create-release`                     | Reuses release creation entry points from card footer actions.                                                                                                     |
| `../../deploy-drawer/state`                | Opens the deploy drawer from a card action without making the list own deploy form state.                                                                          |
| `../../detail/tabs`                        | Uses the detail tab key type when building card navigation URLs. The list must not depend on detail tab components.                                                |
