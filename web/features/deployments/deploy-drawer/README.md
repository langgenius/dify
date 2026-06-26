# Deployment Deploy Drawer

Drawer workflow for choosing a release, selecting an environment, binding runtime credentials, and starting a deployment.

## External Modules

| Module                                                      | Why this module uses it                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `@/app/components/base/skeleton`                            | Reuses skeleton primitives for drawer form loading sections.                                   |
| `../../shared/components/empty-state`                       | Reuses deployment empty/error state presentation inside drawer form sections.                  |
| `../../shared/components/env-var-bindings`                  | Renders deployment environment variable inputs from release deployment options.                |
| `../../shared/components/env-var-bindings-utils`            | Converts contract env var slots into the drawer's env var binding model.                       |
| `../../shared/components/runtime-credential-bindings`       | Renders runtime credential binding choices for the selected deployment target.                 |
| `../../shared/components/runtime-credential-bindings-utils` | Reuses credential slot keys, selected credential mapping, and required-binding validation.     |
| `../../shared/components/title-tooltip`                     | Shows full release and environment labels when select text is visually truncated.              |
| `../../shared/domain/idempotency`                           | Generates deployment idempotency keys for submit requests.                                     |
| `../../shared/domain/release`                               | Formats release metadata shown in the drawer.                                                  |
| `../../shared/domain/release-action`                        | Reuses release/deployment action availability rules for the selected release target.           |
| `../../shared/domain/runtime-status`                        | Reuses runtime deployment status rules for target availability and polling-sensitive behavior. |
