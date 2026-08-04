## Why

The Channel Management facade and Email manager now exist, but the Community and Cloud Workspace Channels surface still has no canonical backend API: the current Email controller is a stub and the frontend remains mock-backed. This change exposes the existing control-plane boundary.

## What Changes

- Add one owner/admin-only Workspace Console API for Resend, Slack, Feishu and DingTalk complete references.
- Scope functional support to Community and Cloud, and add one pre-dispatch edition gate that returns HTTP `501` for the canonical Channels paths on Enterprise without resolving or changing deployment-wide IM ownership.
- Replace the non-functional Email provider controller stub with channel-neutral DTO mapping, trusted management-context construction and stable HTTP error mapping; retain existing IM stubs.
- Add a request-scoped composition root that exposes complete Resend read, validated save, delete and operator-targeted test behavior while keeping every IM operation explicitly unimplemented.
- Add a request-scoped Resend provider adapter that validates credentials and the exact sender domain without sending during save, and sends one idempotent test Email during test.
- Preserve provider-specific IM request unions as future transport contracts without implementing IM provider-dependent operations.
- Keep collection reads independently recoverable so one handler failure does not hide the other channel cards.
- Remove the obsolete Email provider route after the unified Resend route and compatibility tests are in place; retain IM stub routes and DTOs.
- Keep frontend repository wiring, IM directory synchronization, OAuth/callback flows and schema migration outside this change.
- Leave Delivery Runtime behavior entirely unspecified for a separate change.

## Capabilities

### New Capabilities

- `human-input-channel-management-console-api`: Defines the authenticated Workspace Console routes, discriminated DTOs, safe response/error mapping and facade-only controller boundary for Email and IM channel management.

### Modified Capabilities

- None.

## Impact

- `api/controllers/console/workspace/human_input.py`
- `api/controllers/common/human_input_v2_contracts.py`
- `api/services/human_input_channel_management_service.py`
- New channel-management composition under `api/services/`
- New request-scoped Resend management adapter under `api/services/`
- Existing Email repository used by the composition root
- Controller, DTO and composition tests
