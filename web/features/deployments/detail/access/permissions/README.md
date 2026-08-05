# Deployment Access Permissions

Environment permission section for viewing and editing access policies on deployment environments.

## Internal Modules

| Module                                              | Why this module uses it                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `shared`                                            | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`                                       | Reads the route app instance identity for access-policy mutations.             |
| `detail/access`                                     | Reads access route query data for environment access policies.                 |
| `detail/access/permissions/access-subject-selector` | Selects specific members and groups for access policies.                       |

## External Modules

| Module                         | Why this module uses it                                   |
| ------------------------------ | --------------------------------------------------------- |
| `app/components/base/skeleton` | Reuses skeleton primitives for permission loading states. |
