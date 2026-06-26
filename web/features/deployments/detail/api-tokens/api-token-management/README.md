# Deployment API Token Management

API token management section for API endpoint display, token creation, and token listing.

## External Modules

| Module                                   | Why this module uses it                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `../../../route-state`                   | Reads the route app instance identity for API token mutations.   |
| `../../../shared/components/empty-state` | Reuses deployment empty/error state presentation for API tokens. |
| `../../../shared/components/endpoint`    | Reuses copy-pill presentation for API endpoint display.          |
| `../api-keys/api-key-generate-menu`      | Renders the API key creation menu and dialog.                    |
| `../api-keys/api-key-list`               | Renders the API key table and mobile rows.                       |
| `../api-keys/created-token-dialog`       | Displays newly created API tokens.                               |
| `../docs/docs-drawer`                    | Opens API documentation for the current endpoint.                |
| `../state`                               | Reads API tokens route query data.                               |
| `../table-styles`                        | Uses API-token-owned column class names for skeleton rows.       |
