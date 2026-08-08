# Deployment API Token Management

API token management section for API endpoint display, token creation, and token listing.

## Internal Modules

| Module                       | Why this module uses it                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `shared`                     | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |
| `route-state`                | Reads the route app instance identity for API token mutations.                 |
| `detail/api-tokens`          | Reads API tokens route query data and table styles.                            |
| `detail/api-tokens/api-keys` | Renders API key creation, listing, and created-token surfaces.                 |
| `detail/api-tokens/docs`     | Opens API documentation for the current endpoint.                              |

## External Modules

None.
