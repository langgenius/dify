# Deployment Releases History

Release history section for rendering release rows, deployment summaries, and pagination on the releases route.

## Internal Modules

| Module                            | Why this module uses it                                                        |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `shared`                          | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `detail/releases`                 | Reads releases route query and pagination state.                               |
| `detail/releases/release-actions` | Renders release action menus inside release history rows.                      |

## External Modules

| Module                           | Why this module uses it                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `hooks/use-format-time-from-now` | Formats relative release timestamps in release history rows. |
