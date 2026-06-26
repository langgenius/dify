# Deployment Access Channels

Access channels section for viewing webapp and developer API endpoints and toggling webapp access.

## Internal Modules

| Module                          | Why this module uses it                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `route-state`                   | Reads the route app instance identity for access-channel mutations.                  |
| `shared/components/empty-state` | Reuses deployment empty, notice, and error state presentation for channel endpoints. |
| `shared/components/section`     | Reuses the detail section frame for access channel content.                          |
| `shared/components/endpoint`    | Reuses endpoint and copy-pill presentation for channel URLs.                         |
| `detail/access/state`           | Reads access route query data for channel settings.                                  |

## External Modules

| Module                         | Why this module uses it                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `app/components/base/skeleton` | Reuses skeleton primitives for channel endpoint loading states. |
