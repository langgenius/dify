# Deployment Overview

Overview route for release summary, environment status, and access summaries on a deployment app instance.

## External Modules

| Module                                    | Why this module uses it                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@/app/components/base/skeleton`          | Reuses skeleton primitives for overview loading cards and strips.                               |
| `@/hooks/use-format-time-from-now`        | Formats relative release timestamps in the release summary card.                                |
| `../../create-release`                    | Opens release creation from the release summary card.                                           |
| `../../deploy-drawer/state`               | Opens the deploy drawer from environment actions without making overview own deploy form state. |
| `../../route-state`                       | Reads the route app instance identity for overview links and actions.                           |
| `../../shared/components/empty-state`     | Reuses deployment empty-state presentation for missing release or environment data.             |
| `../../shared/components/title-tooltip`   | Shows full release and environment labels when overview text is truncated.                      |
| `../../shared/domain/release`             | Reuses release metadata formatting for the release summary card.                                |
| `../../shared/domain/runtime-status`      | Reuses deployment runtime status rules for overview availability and drift display.             |
| `../../shared/ui/deployment-status-badge` | Reuses deployment status badge styling for access status summaries.                             |
| `../state`                                | Reads detail-owned overview query data.                                                         |
