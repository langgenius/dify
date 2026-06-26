# Deployment Access Subject Selector

Subject selector used by access permission dialogs to search, add, and display members or groups.

## External Modules

| Module                                           | Why this module uses it                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `web/app/components/base/loading`                | Reuses the inline loading indicator while access-subject search is pending.        |
| `web/app/components/base/skeleton`               | Reuses skeleton primitives for selected subject loading rows.                      |
| `web/context/app-context`                        | Reads the current user id to label the current user in selectable subject options. |
| `web/models/access-control`                      | Reuses access-control subject types and group models for selector values.          |
| `web/service/access-control/use-access-subjects` | Searches users and groups for access-policy subject selection.                     |
