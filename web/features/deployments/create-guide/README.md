# Deployment Create Guide

Guided deployment creation workflow for selecting a source, defining the initial release, and optionally deploying to an environment.

## External Modules

| Module                                                  | Why this module uses it                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `web/app/components/app/create-from-dsl-modal/uploader` | Reuses the existing DSL file uploader for the import source step.                                             |
| `web/app/components/base/app-icon`                      | Renders app icons consistently in source app options.                                                         |
| `web/app/components/base/skeleton`                      | Reuses the existing skeleton primitive for source and target loading states.                                  |
| `web/types/app`                                         | Uses app types and mode enums to narrow selectable source apps to workflow apps.                              |
| `shared/components/empty-state`                         | Reuses deployment empty/error state presentation for the source app list.                                     |
| `shared/components/env-var-bindings`                    | Renders target environment variable bindings from computed deployment options.                                |
| `shared/components/env-var-bindings-utils`              | Converts contract env var slots and normalizes env var value-type metadata for target readiness and payloads. |
| `shared/components/runtime-credential-bindings`         | Renders target runtime credential binding choices from computed deployment options.                           |
| `shared/components/runtime-credential-bindings-utils`   | Reuses credential slot keys, selected credential mapping, and required-binding validation.                    |
| `shared/components/title-tooltip`                       | Shows full labels and descriptions when step text is visually truncated.                                      |
| `shared/components/unsupported-dsl-nodes-alert`         | Presents unsupported DSL node feedback from precheck and submission errors.                                   |
| `shared/domain/dsl`                                     | Parses and encodes DSL content for source validation, default names, env var metadata, and submit payloads.   |
| `shared/domain/error`                                   | Converts deployment errors and unsupported DSL node errors into user-facing feedback.                         |
| `shared/domain/feature-flags`                           | Gates the import-DSL source method consistently with the deployments feature flag.                            |
| `shared/domain/idempotency`                             | Generates deployment idempotency keys for create-and-deploy submission.                                       |
| `shared/hooks/use-infinite-scroll`                      | Centralizes infinite-scroll observation and next-page triggering for source app query results.                |
