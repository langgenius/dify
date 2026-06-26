# Deployment Instances Header Actions

Header action for opening the deploy drawer from the instances route.

## Internal Modules

| Module          | Why this module uses it                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `deploy-drawer` | Opens the deploy drawer for the first available undeployed environment. |
| `route-state`   | Reads the route app instance identity for deployment actions.           |
| `detail`        | Reads detail-owned query state and runtime instance rows.               |

## External Modules

None.
