# Deployment Create Release

Release creation dialog for selecting a source app or DSL file and creating a new release for an existing deployment app instance.

## Internal Modules

| Module                                          | Why this module uses it                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `shared/components/title-tooltip`               | Shows full source app labels and descriptions when picker text is visually truncated.          |
| `shared/components/unsupported-dsl-nodes-alert` | Presents unsupported DSL node feedback from release validation and submission errors.          |
| `shared/domain/dsl`                             | Encodes DSL content and validates that imported DSL describes a workflow app.                  |
| `shared/domain/error`                           | Converts deployment errors into user-facing feedback.                                          |
| `shared/domain/feature-flags`                   | Gates the DSL release source consistently with the deployments feature flag.                   |
| `shared/hooks/use-infinite-scroll`              | Centralizes infinite-scroll observation and next-page triggering for source app query results. |

## External Modules

| Module                                              | Why this module uses it                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `app/components/app/create-from-dsl-modal/uploader` | Reuses the existing DSL file uploader for the DSL release source.                |
| `app/components/base/app-icon`                      | Renders source app icons consistently in the source app picker.                  |
| `app/components/base/skeleton`                      | Reuses skeleton primitives for source app picker loading rows.                   |
| `types/app`                                         | Uses app types and mode enums to narrow selectable source apps to workflow apps. |
