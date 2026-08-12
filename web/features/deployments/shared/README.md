# Deployment Shared

Shared deployment domain rules, UI primitives, hooks, and local helpers used by multiple deployment modules.

## Internal Modules

| Module              | Why this module uses it                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `shared/components` | Provides reusable deployment section, table, endpoint, and binding UI.    |
| `shared/domain`     | Provides reusable deployment DSL, release, runtime, and error rules.      |
| `shared/hooks`      | Provides reusable hooks for deployment module workflows.                  |
| `shared/ui`         | Provides reusable deployment status presentation primitives and mappings. |

## External Modules

| Module       | Why this module uses it                                           |
| ------------ | ----------------------------------------------------------------- |
| `types/app`  | Uses app mode enums when parsing deployment DSL content.          |
| `utils/time` | Formats release timestamps for deployment release metadata views. |
