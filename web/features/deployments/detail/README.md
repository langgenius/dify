# Deployment Detail Shell

Detail shell for the deployment app instance routes, including sidebar navigation, route headers, and route-level action slots.

## External Modules

| Module                                 | Why this module uses it                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@/app/components/app-sidebar/*`       | Reuses the application sidebar navigation primitives for the deployment detail sidebar.                   |
| `@/app/components/base/*`              | Reuses base dividers, skeletons, and legacy sidebar icon assets for detail navigation and loading states. |
| `@/app/components/goto-anything/atoms` | Opens the global search command from the detail sidebar shortcut.                                         |
| `@/hooks/use-document-title`           | Sets the browser document title while the detail shell is mounted.                                        |
| `../create-release`                    | Opens release creation from the detail header.                                                            |
| `../deployment-actions`                | Reuses app instance action menu behavior in the detail sidebar.                                           |
| `../route-state`                       | Reads the route app instance identity as the detail module's shared route boundary.                       |
| `../shared/components/title-tooltip`   | Shows full sidebar labels when navigation text is truncated.                                              |
| `../shared/domain/runtime-status`      | Reuses deployment polling intervals for detail-level query refresh.                                       |
| `./api-tokens/section`                 | Renders the developer API header switch for the API tokens route.                                         |
| `./instances/new-deployment-button`    | Renders the new deployment header action for the instances route.                                         |
| `./releases/state`                     | Scopes releases route local state at the detail route boundary.                                           |
