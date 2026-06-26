# Deployment API Keys

API key creation, listing, and generated token presentation for the API tokens route.

## Internal Modules

| Module                           | Why this module uses it                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `route-state`                    | Reads the route app instance identity for API key mutations. |
| `shared/components/detail-table` | Reuses the detail table layout for API key rows.             |
| `shared/components/endpoint`     | Reuses copy-pill presentation for generated token values.    |
| `detail/api-tokens/table-styles` | Uses API-token-owned column class names for API key rows.    |

## External Modules

None.
