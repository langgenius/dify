# Deployment Overview Release Summary

Release summary section for showing the latest release and release creation entry point on the overview route.

## Internal Modules

| Module            | Why this module uses it                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| `create-release`  | Opens release creation from the release summary card.                          |
| `shared`          | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`     | Reads the route app instance identity for release creation.                    |
| `detail/overview` | Reuses overview card and icon styling shared by overview sections.             |

## External Modules

None.
