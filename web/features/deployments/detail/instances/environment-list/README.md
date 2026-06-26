# Deployment Instances Environment List

Environment list section for rendering deployment rows and row-level status summaries on the instances route.

## Internal Modules

| Module                         | Why this module uses it                                                        |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `shared`                       | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `detail/instances`             | Uses instances-owned table column class names for deployment rows.             |
| `detail/instances/row-actions` | Renders row-level deployment actions for each environment.                     |

## External Modules

None.
