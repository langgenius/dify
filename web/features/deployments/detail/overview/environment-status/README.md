# Deployment Overview Environment Status

Environment status section for previewing runtime deployments and opening deployment actions from the overview route.

## Internal Modules

| Module            | Why this module uses it                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| `deploy-drawer`   | Opens the deploy drawer from overview environment actions.                     |
| `shared`          | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`     | Reads the route app instance identity for environment links and actions.       |
| `detail/overview` | Reuses overview card and icon styling shared by overview sections.             |

## External Modules

None.
