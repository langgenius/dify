# difyctl KnowledgeFS command-specific OpenAPI integration

Date: 2026-07-31

## What changed

- Assigned stable OpenAPI operation IDs to the existing read-only KnowledgeFS routes for `ls`,
  `tree`, `grep`, `find`, `diff`, `cat`, and `stat`.
- Exported one Capability v2 operation per command, each with its exact GET method, route, action,
  and knowledge-space resource binding.
- Added matching Dify product operations and bearer-authenticated OpenAPI controller endpoints.
- Added independent `difyctl knowledge fs <command>` leaves. Each leaf calls only its matching
  OpenAPI operation; no command string or shell pipeline is transported.

## Why

Each filesystem command has a distinct request and response contract. Keeping those contracts as
separate endpoints preserves typed query validation, least-privilege capability issuance, clear
audit operation IDs, and discoverable difyctl help. A generic execute endpoint would erase those
boundaries and require a second command parser at the transport seam.

## Command and endpoint mapping

| difyctl command | Dify OpenAPI suffix | KnowledgeFS route |
| --- | --- | --- |
| `knowledge fs ls` | `/fs/ls` | `GET /knowledge-spaces/{id}/fs/ls` |
| `knowledge fs tree` | `/fs/tree` | `GET /knowledge-spaces/{id}/fs/tree` |
| `knowledge fs grep` | `/fs/grep` | `GET /knowledge-spaces/{id}/fs/grep` |
| `knowledge fs find` | `/fs/find` | `GET /knowledge-spaces/{id}/fs/find` |
| `knowledge fs diff` | `/fs/diff` | `GET /knowledge-spaces/{id}/fs/diff` |
| `knowledge fs cat` | `/fs/cat` | `GET /knowledge-spaces/{id}/fs/cat` |
| `knowledge fs stat` | `/fs/stat` | `GET /knowledge-spaces/{id}/fs/stat` |

The Dify prefix is
`/openapi/v1/workspaces/{workspace_id}/knowledge-fs/spaces/{control_space_id}`.

## Security and operational bounds

- All seven operations are read-only and issue a command-specific knowledge-space capability.
- Workspace membership and `WORKSPACE_READ` bearer scope are checked at the Dify OpenAPI boundary.
- KnowledgeFS remains authoritative for path visibility, candidate grants, limits, consistency,
  and result validation.
- `head`, `jq`, `tail`, and `wc` are local shell-style transforms, not KnowledgeFS resource
  operations, so this integration does not expose them as remote endpoints.
