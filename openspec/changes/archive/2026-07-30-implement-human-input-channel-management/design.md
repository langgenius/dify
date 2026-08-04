## Context

The frontend Channels surface already presents Email, Slack, Feishu and DingTalk together, but its repository is mock-backed and named around IM concerns. Backend state has a different shape: `HumanInputEmailProvider` stores one tenant-level Resend configuration, while the existing Human Input v2 IM Control Plane owns Integration revisions, provider replacement, identities, bindings and sync runs.

The first management release supports exactly Resend, Slack, Feishu and DingTalk. Provider values present in lower-level IM persistence or transport contracts do not become management capabilities until a later OpenSpec change adds their complete candidate, handler and product surface.

The management abstraction therefore needs one stable application entry point without pretending that Email and IM share one aggregate or persistence model. Provider I/O must remain outside database transactions, secrets must not cross safe read boundaries, and existing IM CAS/replacement semantics must remain authoritative.

## Goals / Non-Goals

**Goals:**

- Provide one channel-neutral management facade for Email and IM.
- Expose common safe views and capability discovery while preserving typed provider-specific commands and failures.
- Route Email management to a dedicated Email handler/repository.
- Route each supported IM provider to its own handler over shared existing IM Control Plane dependencies.
- Keep one Email configuration independent from the one-active-IM rule.
- Prevent controller and frontend adapter code from depending on channel persistence details.

**Non-Goals:**

- Introduce one generic repository or common database table for all channels.
- Replace or weaken the existing IM Integration aggregate, CAS, replacement, binding or sync behavior.
- Implement a concrete Resend HTTP client or IM provider clients.
- Implement console controllers, generated clients or frontend API repository wiring.
- Route v1 or v2 Human Input runtime delivery through configured channels.
- Configure Dify system email.

## Decisions

### 1. A channel-neutral facade owns application dispatch

`HumanInputChannelManagementService` receives trusted management context and discriminated commands. It resolves a handler from a registry keyed by channel kind and provider, then delegates the operation without inspecting provider credentials or repository records.

Each registry entry owns exactly one complete channel reference. Resend, Slack, Feishu and DingTalk are independently registered; a handler does not claim several provider references and registry enumeration does not deduplicate by handler identity. Provider handlers may share lower-level application or repository dependencies when their lifecycle belongs to the same aggregate.

The common use cases are:

- list supported and configured channels;
- get one safe channel view;
- test a candidate configuration;
- save a candidate configuration;
- delete a configured channel.

### 2. Persisted views and candidate test results are separate

List, get, save and delete return a credential-free `ChannelView` of persisted state containing:

- channel kind and provider;
- effective scope kind;
- configured state and common connection status;
- safe provider summary;
- supported management capabilities;
- safe status reason and last-check metadata when applicable.

Test returns a credential-free `ChannelTestResult` containing only the tested channel reference, effective scope, candidate test status, safe test summary and check metadata. It does not contain `configured`, capabilities, Email key-presence state, IM integration identity or IM configuration revision. This prevents a successful unsaved candidate from being mistaken for the current configuration and prevents candidate fields from being combined with persisted metadata.

Commands are not string dictionaries. Email uses a Resend candidate; IM uses provider-specific integration commands already understood by the IM application boundary. Adding a provider extends the union and registry rather than adding conditionals to controllers.

Connection status is a non-live snapshot in this change. Listing or reading channels does not perform provider I/O. A follow-up may refresh the latest state from delivery/send logs or from a concrete provider capability probe that validates credentials, permissions and effective provider features.

### 3. Management context carries trusted scope and actor facts

The facade receives a server-derived context containing Workspace, Organization and actor facts required by handlers. Callers cannot select an arbitrary tenant through a provider configuration payload.

The Email handler uses the Workspace scope and operator account email. Each IM provider handler maps the same trusted context to the ownership model expected by the existing IM Control Plane, including deployment or Organization scope where applicable.

Authorization decorators and deployment-plan visibility remain controller responsibilities, but handlers and repositories still enforce ownership on every read and write.

### 4. Handler capabilities express differences instead of fake uniformity

Capabilities describe implemented management operations: configuration, test, delete, Email secret retention and IM provider replacement. IM handlers do not advertise secret retention, and IM candidates accept only explicit new secret values until concrete provider ports implement existing-secret resolution and protected credential merging. Capabilities are provider-level declarations in this change rather than live health checks. Unsupported operations return a stable unsupported-operation result before provider or persistence work.

Provider health and credential validity are represented by the status snapshot, not inferred from the declared capability set.

### 5. Email and IM persistence remain separate

The facade depends on handler ports, not a `ChannelRepository`.

- The Email handler owns `EmailChannelRepository`, credential protection and the Resend validation port.
- IM provider handlers delegate to shared existing IM aggregate and SQLAlchemy repository dependencies.

This preserves Email's single Workspace row and internal timestamp snapshot while retaining IM's complete `integration_id + config_version` CAS, replacement invalidation and sync semantics.

List orchestration follows the registry boundary and asks each independently registered handler for one safe view. Slack, Feishu and DingTalk handlers may share the existing IM Control Plane dependencies, but the registry does not expose an IM-family handler. Any later bulk-read or request-scoped snapshot optimization must remain behind those handlers and must not change the one-ref-per-handler registration contract.

### 6. IM delegation cannot bypass control-plane decisions

Each IM provider handler maps common commands into existing IM application commands and maps their safe results back into common views. It must not write IM ORM records, rotate credentials, replace providers or delete integrations directly.

Deleting or replacing an IM channel continues to invalidate identities/bindings exactly as decided by the IM aggregate. Email configuration is never considered an active IM integration and does not participate in replacement.

### 7. Cross-channel policy is narrow

One Workspace Email configuration may coexist with one active IM integration. The facade does not impose a global one-channel limit.

When another IM provider is selected, its handler returns or applies the existing explicit replacement decision. Saving or deleting Email cannot mutate IM state; saving or deleting IM cannot mutate Email state.

### 8. Common failures wrap safe channel-specific causes

The facade exposes common categories such as unsupported channel, unsupported operation, not configured, conflict, stale configuration, validation failure and provider failure. A safe channel-specific code may accompany the category for UI field mapping.

Credentials, provider raw responses and ORM diagnostics never enter common results, logs or metrics.

### 9. Email management keeps complete-candidate semantics

The Email handler exposes safe query, candidate test, validated save and delete. A candidate contains provider, sender fields and either a new API key or an explicit retain-existing-key directive.

Save validation verifies the complete candidate without sending a test email. Test connection uses the candidate and sends one test email to the authenticated operator address without persistence or system-mail fallback. Its result reports the operator recipient and candidate sender identity without representing the candidate as persisted state.

### 10. Email validated writes reuse the existing persistence snapshot

The Email repository uses configuration ID plus `updated_at` as an internal snapshot across external validation. Conditional update rejects a row changed or deleted while validation was in flight. A successful update assigns an application timestamp strictly later than the current value.

First creation locks the stable Tenant owner row and rechecks the existing unique tenant configuration. No new column or migration is required.

## Risks / Trade-offs

- [The common facade becomes a lowest-common-denominator API] → Keep commands discriminated and expose capabilities; do not flatten provider configuration fields.
- [IM behavior is accidentally reimplemented] → Contract-test the adapter against existing IM ports and prohibit direct IM ORM imports.
- [One list request may repeat an IM snapshot read across provider handlers] → Prefer the explicit one-ref-per-handler routing contract; add a shared bulk-read or request-scoped snapshot behind the IM handlers only when measurement justifies it.
- [A Resend validation succeeds before a concurrent Email update] → Apply the validated candidate with `id + updated_at` conditional update and return stale on mismatch.
- [Timestamp snapshots fail to advance] → Assign a strictly later application timestamp and cover equal-clock inputs.
- [The facade lands before concrete provider adapters] → Use deterministic handler fakes and preserve stable ports for follow-up adapters.

## Migration Plan

No schema or data migration is required.

1. Add common channel values, commands, safe views, capabilities and handler registry.
2. Implement the facade against deterministic Email and IM handler fakes.
3. Implement per-provider IM handler adapters over shared existing IM Control Plane dependencies and use its richer invariants to validate the common facade boundary.
4. Extract Email configuration ownership into its handler and repository using the existing table.
5. Switch future console API work to the facade rather than channel-specific repositories.
6. Roll back by removing the facade and adapters; existing Email and IM records remain unchanged.
