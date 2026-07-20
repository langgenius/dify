# Deployment Instances

Instances route for listing environment deployments and running deployment row actions.

## Internal Modules

| Module                              | Why this module uses it                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `detail`                            | Reads detail-owned query state and runtime instance rows before composing sections. |
| `shared`                            | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers.      |
| `detail/instances/environment-list` | Renders environment deployment rows.                                                |
| `detail/instances/header-actions`   | Renders the new deployment action for empty instances.                              |

## External Modules

| Module                         | Why this module uses it                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `app/components/base/skeleton` | Reuses skeleton primitives for deployment table loading states. |
