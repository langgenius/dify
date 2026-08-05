# Deployment Create Release

Release creation dialog for selecting a source app or DSL file and creating a new release for an existing deployment app instance.

## Internal Modules

| Module   | Why this module uses it                                                        |
| -------- | ------------------------------------------------------------------------------ |
| `shared` | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |

## External Modules

| Module                                              | Why this module uses it                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `app/components/app/create-from-dsl-modal/uploader` | Reuses the existing DSL file uploader for the DSL release source.                |
| `app/components/base/app-icon`                      | Renders source app icons consistently in the source app picker.                  |
| `app/components/base/skeleton`                      | Reuses skeleton primitives for source app picker loading rows.                   |
| `types/app`                                         | Uses app types and mode enums to narrow selectable source apps to workflow apps. |
