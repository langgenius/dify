# Deployment Instances

Instances route for listing environment deployments and running deployment row actions.

## External Modules

| Module                                        | Why this module uses it                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@/app/components/base/skeleton`              | Reuses skeleton primitives for deployment table loading states.                                   |
| `../../deploy-drawer/state`                   | Opens the deploy drawer from new-deployment and row action flows.                                 |
| `../../route-state`                           | Reads the route app instance identity for deployment mutations.                                   |
| `../../shared/components/empty-state`         | Reuses deployment empty/error state presentation for the instances route.                         |
| `../../shared/domain/idempotency`             | Generates idempotency keys for undeploy/redeploy actions.                                         |
| `../../shared/domain/release`                 | Formats release metadata shown in deployment rows.                                                |
| `../../shared/domain/runtime-status`          | Reuses deployment status rules for row availability, empty states, and polling-sensitive actions. |
| `../../shared/components/detail-table`        | Reuses the detail table layout for desktop and mobile deployment rows.                            |
| `../../shared/components/detail-table-styles` | Reuses column class names and action trigger styles shared by detail tables.                      |
| `../state`                                    | Reads detail-owned environment deployment query data.                                             |
