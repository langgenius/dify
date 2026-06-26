# Deployment Overview

Overview route for release summary, environment status, and access summaries on a deployment app instance.

## External Modules

| Module                                | Why this module uses it                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `../../route-state`                   | Reads the route app instance identity for overview links.                  |
| `../../shared/components/empty-state` | Reuses deployment empty/error state presentation for the overview route.   |
| `../../shared/domain/runtime-status`  | Reuses deployment status rules to compute overview counts.                 |
| `../state`                            | Reads detail-owned overview query data before composing overview sections. |
