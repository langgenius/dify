# Deployment Instances Row Actions

Row action menu and dialogs for deploying, redeploying, and undeploying an environment deployment.

## Internal Modules

| Module                                  | Why this module uses it                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `deploy-drawer/state`                   | Opens the deploy drawer from row-level deploy and redeploy flows. |
| `route-state`                           | Reads the route app instance identity for deployment mutations.   |
| `shared/components/detail-table-styles` | Reuses action trigger styles shared by detail tables.             |
| `shared/domain/idempotency`             | Generates idempotency keys for undeploy and redeploy actions.     |
| `shared/domain/runtime-status`          | Reuses deployment status rules for action availability.           |

## External Modules

None.
