# Deployment Instances

Instances route for listing environment deployments and running deployment row actions.

## External Modules

| Module                             | Why this module uses it                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `web/app/components/base/skeleton` | Reuses skeleton primitives for deployment table loading states.                     |
| `shared/components/detail-table`   | Reuses the detail table layout for deployment table skeletons.                      |
| `shared/components/empty-state`    | Reuses deployment empty/error state presentation for the instances route.           |
| `detail/state`                     | Reads detail-owned query state and runtime instance rows before composing sections. |
