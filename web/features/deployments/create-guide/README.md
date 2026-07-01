# Deployment Create Guide

Guided deployment creation workflow for selecting a source, defining the initial release, and optionally deploying to an environment.

## Internal Modules

| Module   | Why this module uses it                                                        |
| -------- | ------------------------------------------------------------------------------ |
| `shared` | Reuses shared deployment domain rules, UI primitives, hooks, or local helpers. |

## External Modules

| Module                                              | Why this module uses it                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `app/components/app/create-from-dsl-modal/uploader` | Reuses the existing DSL file uploader for the import source step.                |
| `app/components/base/app-icon`                      | Renders app icons consistently in source app options.                            |
| `app/components/base/skeleton`                      | Reuses the existing skeleton primitive for source and target loading states.     |
| `types/app`                                         | Uses app types and mode enums to narrow selectable source apps to workflow apps. |
