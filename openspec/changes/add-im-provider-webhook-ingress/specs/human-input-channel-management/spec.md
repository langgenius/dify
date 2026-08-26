## ADDED Requirements

### Requirement: IM Channel Webhook projection MUST remain credential-free

The IM Integration owner MUST derive `IMIntegrationView.webhook_url` from the effective deployment mode、`IMProvider.supports_webhook()`、credential-runtime availability、`TRIGGER_URL` and persisted `webhook_id`。The Console controller MUST continue mapping that field into the existing canonical `ChannelSummary`。Collection、item and mutation projection MUST NOT decrypt the credential envelope、construct an adapter or call a Provider。

#### Scenario: Webhook-capable Channel is projected
- **WHEN** effective mode is `WEBHOOK`、`IMProvider.supports_webhook()` returns `True` and production can resolve a bound cipher for the Integration owner
- **THEN** list、detail、create、update and replacement summaries MUST return the derived `webhook_url`
- **AND** each projection MUST use the same URL derivation function

#### Scenario: Channel is not runtime-ready for Webhook
- **WHEN** mode is `STREAM`、`IMProvider.supports_webhook()` returns `False` or a tenant-less Integration has no injected deployment-bounded cipher
- **THEN** `ChannelSummary.webhook_url` MUST be `None`
- **AND** the configured Channel MUST remain visible in `GET /channels`

#### Scenario: Channel summary is read
- **WHEN** Console lists or reads a configured IM Channel
- **THEN** projection MUST use persisted `app_identifier` and `webhook_id`
- **AND** projection MUST NOT call `IMCredentialCodec.load()`、`build_im_provider_adapter()` or `create_webhook_handler()`

#### Scenario: Deployment origin changes
- **WHEN** operator changes `TRIGGER_URL`
- **THEN** the next summary MUST contain the new origin
- **AND** management MUST NOT update the Integration row、configuration revision or credential envelope
