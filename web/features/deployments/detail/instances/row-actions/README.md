# Deployment Instances Row Actions

Row action menu and dialogs for deploying, redeploying, and undeploying an environment deployment.

## Internal Modules

| Module          | Why this module uses it                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `deploy-drawer` | Opens the deploy drawer from row-level deploy and redeploy flows.              |
| `shared`        | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`   | Reads the route app instance identity for deployment mutations.                |

## External Modules

None.
