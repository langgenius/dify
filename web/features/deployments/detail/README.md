# Deployment Detail Shell

Detail shell for the deployment app instance routes, including sidebar navigation, route headers, and route-level action slots.

## Internal Modules

| Module                            | Why this module uses it                                                        |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `create-release`                  | Opens release creation from the detail header.                                 |
| `deployment-actions`              | Reuses app instance action menu behavior in the detail sidebar.                |
| `shared`                          | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`                     | Reads route identity used by detail query and tab atoms.                       |
| `detail/api-tokens`               | Renders the developer API header switch for the API tokens route.              |
| `detail/instances/header-actions` | Renders the new deployment header action for the instances route.              |

## External Modules

| Module                               | Why this module uses it                                           |
| ------------------------------------ | ----------------------------------------------------------------- |
| `app/components/goto-anything/atoms` | Opens the global search command from the detail sidebar shortcut. |
