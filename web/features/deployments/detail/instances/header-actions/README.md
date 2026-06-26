# Deployment Instances Header Actions

Header action for opening the deploy drawer from the instances route.

## External Modules

| Module                         | Why this module uses it                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `../../../deploy-drawer/state` | Opens the deploy drawer for the first available undeployed environment. |
| `../../../route-state`         | Reads the route app instance identity for deployment actions.           |
| `../../state`                  | Reads detail-owned query state and runtime instance rows.               |
