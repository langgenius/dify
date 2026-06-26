# Deployment API Keys

API key creation, listing, and generated token presentation for the API tokens route.

## External Modules

| Module                                           | Why this module uses it                                      |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `../../../route-state`                           | Reads the route app instance identity for API key mutations. |
| `../../../shared/components/detail-table`        | Reuses the detail table layout for API key rows.             |
| `../../../shared/components/detail-table-styles` | Reuses column class names shared by detail tables.           |
| `../../../shared/components/endpoint`            | Reuses copy-pill presentation for generated token values.    |
