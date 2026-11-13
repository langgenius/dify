# Workspace channels

The Account Settings Channels tab configures Email and IM delivery and inspects directory synchronization. It is available only to workspace managers when `NEXT_PUBLIC_ENABLE_HITL_IM` is true and `/features.im_centrally_managed` is false. The release flag defaults to false; disabling it preserves saved channels and credentials and restores the existing V1 entry points.

## Data ownership

The surface uses generated `consoleQuery.workspaces.current.humanInput.v2` options. Channel lists and provider definitions are loaded at the page owner. Redacted channel details are requested when a configuration session opens. Shared mutation defaults own generated-key invalidation; the feature has no repository, DTO status mirror, or private cache namespace.

`credentials.ts` owns credential draft payload shaping and saved redaction metadata. Optional credentials can be retained, replaced, or explicitly cleared. Successful saves and closing clear typed secrets; rejected writes keep the draft available for correction. Credential mutations have zero cache retention and reset after completion. Generated mutations receive typed payloads while pending; the outer orchestration mutation receives credentials through a ref rather than mutation variables.

The configuration and sync-detail sessions mount inside `DialogContent`. Their roots remain mounted while closing, and the subject survives until the closing lifecycle completes. `callback-setup.tsx` displays each provider's actual webhook URL and provider-specific setup destination.

## Directory synchronization

The server exposes the latest run only. The selected run ID and result filter are stored with nuqs in `sync_run_id` and `sync_result`. A different latest ID is reported as changed rather than displayed under the requested identity. The summary polls only queued/running runs and refreshes related generated caches on an observed active-to-terminal transition.

The result view consumes generated run/result types directly. CSV export requests up to 100 rows per page and verifies the latest run before and after the complete export. It never invents contact email, actor, partial-success, or OAuth fields absent from the contract.

## Verification

Feature tests exercise real generated clients and query policies with mocked HTTP responses, retaining the actual dialogs, forms, and URL-state owner. The API's generated types determine valid scenarios. No production mock repository or mock-only status is shipped.
