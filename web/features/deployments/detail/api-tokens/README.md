# Deployment API Tokens

API tokens route for API token management, endpoint display, and API documentation drawer.

## External Modules

| Module                                        | Why this module uses it                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `@/app/components/base/skeleton`              | Reuses skeleton primitives for API token and endpoint loading states.                    |
| `@/app/components/develop/template/*`         | Reuses localized workflow API documentation templates in the docs drawer.                |
| `@/context/i18n`                              | Reads the current locale for API documentation template selection.                       |
| `@/hooks/use-theme`                           | Reads the current theme for rendering developer API documentation.                       |
| `@/i18n-config/language`                      | Maps the current locale to the API documentation language.                               |
| `@/types/app`                                 | Uses app and theme enums for API documentation rendering.                                |
| `../../route-state`                           | Reads the route app instance identity for API token queries and mutations.               |
| `../../shared/components/empty-state`         | Reuses deployment empty/error state presentation for API token content.                  |
| `../../shared/components/detail-table`        | Reuses the detail table layout for desktop and mobile API token rows.                    |
| `../../shared/components/detail-table-styles` | Reuses column class names shared by detail tables.                                       |
| `../../shared/components/endpoint`            | Reuses endpoint and copy-pill presentation for API endpoint and generated token display. |
