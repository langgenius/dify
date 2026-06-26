# Deployment Instances

Instances route for listing environment deployments and running deployment row actions.

## External Modules

| Module                                        | Why this module uses it                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@/app/components/base/skeleton`              | Reuses skeleton primitives for deployment table loading states.                     |
| `../../shared/components/detail-table`        | Reuses the detail table layout for deployment table skeletons.                      |
| `../../shared/components/detail-table-styles` | Reuses column class names for deployment table skeletons.                           |
| `../../shared/components/empty-state`         | Reuses deployment empty/error state presentation for the instances route.           |
| `../../shared/domain/runtime-status`          | Reuses deployment status rules to filter deployable environment rows.               |
| `../state`                                    | Reads detail-owned environment deployment query data before composing row sections. |
