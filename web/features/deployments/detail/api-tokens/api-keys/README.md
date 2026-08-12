# Deployment API Keys

API key creation, listing, and generated token presentation for the API tokens route.

## Internal Modules

| Module              | Why this module uses it                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `shared`            | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`       | Reads the route app instance identity for API key mutations.                   |
| `detail/api-tokens` | Uses API-token-owned query state and table styles.                             |

## External Modules

None.
