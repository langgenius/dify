# Deployment Detail Shell

Detail shell for the deployment app instance routes, including sidebar navigation, route headers, and route-level action slots.

## Internal Modules

| Module                            | Why this module uses it                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `create-release`                  | Opens release creation from the detail header.                                      |
| `deployment-actions`              | Reuses app instance action menu behavior in the detail sidebar.                     |
| `shared`                          | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers.      |
| `route-state`                     | Reads the route app instance identity as the detail module's shared route boundary. |
| `detail/api-tokens`               | Renders the developer API header switch for the API tokens route.                   |
| `detail/instances/header-actions` | Renders the new deployment header action for the instances route.                   |
| `detail/releases`                 | Scopes releases route local state at the detail route boundary.                     |

## External Modules

| Module                               | Why this module uses it                                           |
| ------------------------------------ | ----------------------------------------------------------------- |
| `app/components/goto-anything/atoms` | Opens the global search command from the detail sidebar shortcut. |
