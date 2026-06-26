# Deployment Instances Environment List

Environment list section for rendering deployment rows and row-level status summaries on the instances route.

## External Modules

| Module                                           | Why this module uses it                                      |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `../../../shared/components/detail-table`        | Reuses the detail table layout for desktop and mobile rows.  |
| `../../../shared/components/detail-table-styles` | Reuses column class names shared by detail tables.           |
| `../../../shared/domain/release`                 | Formats release metadata shown in deployment rows.           |
| `../../../shared/domain/runtime-status`          | Reuses deployment status rules for row presentation.         |
| `../../../shared/ui/deployment-status-badge`     | Reuses deployment status badge styling for environment rows. |
| `../row-actions/deployment-row-actions`          | Renders row-level deployment actions for each environment.   |
