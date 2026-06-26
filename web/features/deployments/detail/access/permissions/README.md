# Deployment Access Permissions

Environment permission section for viewing and editing access policies on deployment environments.

## External Modules

| Module                                   | Why this module uses it                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `@/app/components/base/skeleton`         | Reuses skeleton primitives for permission loading states.                     |
| `@/models/access-control`                | Reuses app access-control enums for policy conversion and permission dialogs. |
| `../../../route-state`                   | Reads the route app instance identity for access-policy mutations.            |
| `../../../shared/components/empty-state` | Reuses deployment empty/error state presentation for environment permissions. |
| `../../../shared/components/section`     | Reuses the detail section frame for permissions content.                      |
| `../state`                               | Reads access route query data for environment access policies.                |
