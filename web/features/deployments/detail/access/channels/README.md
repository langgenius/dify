# Deployment Access Channels

Access channels section for viewing webapp and developer API endpoints and toggling webapp access.

## Internal Modules

| Module          | Why this module uses it                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `shared`        | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`   | Reads the route app instance identity for access-channel mutations.            |
| `detail/access` | Reads access route query data for channel settings.                            |

## External Modules

| Module                         | Why this module uses it                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `app/components/base/skeleton` | Reuses skeleton primitives for channel endpoint loading states. |
