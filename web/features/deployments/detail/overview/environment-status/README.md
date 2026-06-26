# Deployment Overview Environment Status

Environment status section for previewing runtime deployments and opening deployment actions from the overview route.

## Internal Modules

| Module                                   | Why this module uses it                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `deploy-drawer/state`                    | Opens the deploy drawer from overview environment actions.                 |
| `route-state`                            | Reads the route app instance identity for environment links and actions.   |
| `shared/components/empty-state`          | Reuses deployment empty-state presentation for missing environment data.   |
| `shared/components/title-tooltip`        | Shows full environment and release labels when overview text is truncated. |
| `shared/domain/release`                  | Reuses release metadata formatting for environment tiles.                  |
| `shared/domain/runtime-status`           | Reuses runtime deployment status rules for availability and drift display. |
| `shared/ui/deployment-status-badge`      | Reuses deployment status badge styling for environment tiles.              |
| `shared/ui/deployment-status-style`      | Reuses deployment status label mapping for environment tiles.              |
| `detail/overview/components/card-styles` | Reuses overview card and icon styling shared by overview sections.         |

## External Modules

None.
