# Deployment API Token Docs

API documentation drawer for the API tokens route.

## External Modules

| Module                                | Why this module uses it                                       |
| ------------------------------------- | ------------------------------------------------------------- |
| `web/app/components/develop/template` | Reuses localized workflow API documentation templates.        |
| `web/context/i18n`                    | Reads the current locale for documentation template choice.   |
| `web/hooks/use-theme`                 | Reads the current theme for documentation rendering.          |
| `web/i18n-config/language`            | Maps the current locale to the documentation language.        |
| `web/types/app`                       | Uses app and theme enums for documentation rendering.         |
| `route-state`                         | Reads the route app instance identity for documentation copy. |
