# Deployment Access Subject Selector

Subject selector used by access permission dialogs to search, add, and display members or groups.

## External Modules

| Module                                         | Why this module uses it                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `@/app/components/base/loading`                | Reuses the inline loading indicator while access-subject search is pending.        |
| `@/app/components/base/skeleton`               | Reuses skeleton primitives for selected subject loading rows.                      |
| `@/context/app-context`                        | Reads the current user id to label the current user in selectable subject options. |
| `@/models/access-control`                      | Reuses access-control subject types and group models for selector values.          |
| `@/service/access-control/use-access-subjects` | Searches users and groups for access-policy subject selection.                     |
