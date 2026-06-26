# Deployment Releases

Releases route for release history, release actions, deployment summaries, and release DSL export.

## External Modules

| Module                           | Why this module uses it                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `../../route-state`              | Reads the route app instance identity for release queries.   |
| `../../shared/domain/pagination` | Reuses release history page size in route-owned query state. |
