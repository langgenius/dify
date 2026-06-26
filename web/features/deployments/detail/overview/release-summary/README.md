# Deployment Overview Release Summary

Release summary section for showing the latest release and release creation entry point on the overview route.

## External Modules

| Module                                   | Why this module uses it                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `create-release`                         | Opens release creation from the release summary card.              |
| `route-state`                            | Reads the route app instance identity for release creation.        |
| `shared/components/empty-state`          | Reuses deployment empty-state presentation when no release exists. |
| `shared/components/title-tooltip`        | Shows full release labels when summary text is truncated.          |
| `shared/domain/release`                  | Reuses release metadata formatting for the release summary card.   |
| `detail/overview/components/card-styles` | Reuses overview card and icon styling shared by overview sections. |
