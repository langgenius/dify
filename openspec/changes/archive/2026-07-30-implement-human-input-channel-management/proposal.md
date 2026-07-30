## Why

The product presents Email and IM integrations through one Workspace Channels surface, but the backend has no channel-neutral management boundary. Email configuration lacks a real service/repository lifecycle, while IM already has a richer control plane; without a shared facade, controllers and frontend adapters must branch on both models and can bypass channel-specific invariants.

## What Changes

- Introduce a channel-neutral Human Input management service and handler registry for listing, reading, testing, saving and deleting Resend Email plus Slack, Feishu and DingTalk IM channels through discriminated commands.
- Define a common safe channel projection with provider, scope, status, capabilities and credential-free summary while preserving provider-specific configuration types.
- Add a Resend Email channel handler with candidate validation, credential protection, atomic configuration lifecycle and a dedicated Email repository over the existing table.
- Add independently registered Slack, Feishu and DingTalk channel handler adapters that share and delegate to the existing Human Input v2 IM Control Plane instead of duplicating its repository or CAS semantics.
- Allow one Email configuration to coexist with the single active IM integration; adding or replacing IM providers continues to follow the IM aggregate rules.
- Keep persistence aggregate-specific: the shared management service coordinates handlers but does not introduce a generic multi-table Channel repository.
- Reuse the existing Email provider schema and timestamps; no schema or data migration is required.
- Keep concrete Resend HTTP calls, console controller wiring, frontend API integration and runtime notification delivery in separate changes.

## Capabilities

### New Capabilities

- `human-input-channel-management`: Defines the channel-neutral management facade, handler dispatch, safe projections, capability discovery and delegation to Email and IM implementations.
- `human-input-email-channel-management`: Defines the Resend Email handler, credential lifecycle and transactional Email repository semantics.

### Modified Capabilities

- None.

## Impact

- `api/core/human_input_v2/channel_management/`
- `api/core/human_input_v2/email_channel/`
- `api/services/human_input_channel_management_service.py`
- `api/services/human_input_email_channel_manager.py`
- `api/services/human_input_im_channel_manager.py`
- `api/repositories/human_input_v2/email_channel/`
- Existing `api/core/human_input_v2/im_integration/` and `api/repositories/human_input_v2/im_integration/` consumers
- Existing `HumanInputEmailProvider` records and Email provider controller DTOs
- Focused domain, service, repository and IM delegation tests
- Follow-up concrete Resend adapter, console API, frontend repository and runtime delivery changes
