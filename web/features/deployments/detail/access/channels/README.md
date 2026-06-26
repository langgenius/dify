# Deployment Access Channels

Access channels section for viewing webapp and developer API endpoints and toggling webapp access.

## External Modules

| Module                                   | Why this module uses it                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `@/app/components/base/skeleton`         | Reuses skeleton primitives for channel endpoint loading states.                      |
| `../../../route-state`                   | Reads the route app instance identity for access-channel mutations.                  |
| `../../../shared/components/empty-state` | Reuses deployment empty, notice, and error state presentation for channel endpoints. |
| `../../../shared/components/section`     | Reuses the detail section frame for access channel content.                          |
| `../../../shared/components/endpoint`    | Reuses endpoint and copy-pill presentation for channel URLs.                         |
| `../state`                               | Reads access route query data for channel settings.                                  |
