# Deployment Overview

Overview route for release summary, environment status, and access summaries on a deployment app instance.

## Internal Modules

| Module                               | Why this module uses it                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `shared`                             | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`                        | Reads the route app instance identity for overview query, links, and actions.  |
| `detail/overview/access-summary`     | Renders access and API token status summary sections.                          |
| `detail/overview/environment-status` | Renders environment deployment status tiles.                                   |
| `detail/overview/release-summary`    | Renders latest release summary and release creation entry point.               |

## External Modules

None.
